// tableStructureRepair.js
import { BASE, EDITOR, USER } from '../../core/manager.js';
import { updateSystemMessageTableStatus } from '../renderer/tablePushToChat.js';

// 六张世界状态表的标准结构。这里独立保存一份“结构底线”，避免用户设置、旧预设或AI整理结果
// 暂时落后时反过来把已经升级的表头改坏。自定义表仍继续使用用户自己的tableStructure。
const WORLD_MEMORY_HEADERS = {
    '当前状态表': ['日期','时间','地点','当前场景人物'],
    '角色状态表': ['姓名','性别','种族','年龄','修为','灵根/体质','灵力','神识','身体状态','灵石','钱财','技能/术法','擅长','其他状态'],
    '背包表': ['物品名','类型','数量','状态/品质','备注'],
    '当前任务与约定表': ['事项','相关人物','内容','地点/期限','当前状态'],
    '人物表': ['姓名','别名/称呼','性别','身份/所属','修为','外貌特征','性格','与玩家关系','当前状态','重要信息','当前地点','年龄/最后确认时间','主要能力','主要目标/重要事项'],
    '历史事件表': ['时间','地点','涉及人物','事件','结果'],
};

// 仅处理明确等价的旧称/常见误命名；不做模糊猜测。
const HEADER_ALIASES = {
    '人物表': {
        '别名': '别名/称呼',
        '称呼': '别名/称呼',
        '所属势力': '身份/所属',
        '当前所在地点': '当前地点',
        '所在地点': '当前地点',
        '所在地': '当前地点',
        '最后确认时间': '年龄/最后确认时间',
        '年龄/确认时间': '年龄/最后确认时间',
        '能力': '主要能力',
        '当前目标': '主要目标/重要事项',
        '主要目标': '主要目标/重要事项',
    },
};

const KEY_HEADERS = {
    '角色状态表': ['姓名'],
    '背包表': ['物品名','类型','状态/品质'],
    '当前任务与约定表': ['事项'],
    '人物表': ['姓名'],
    '历史事件表': ['时间','地点','涉及人物','事件'],
};

const guardedSheets = new WeakSet();

function normalize(value) {
    return String(value ?? '').trim();
}

function canonicalHeader(sheetName, header) {
    const value = normalize(header);
    return HEADER_ALIASES[sheetName]?.[value] || value;
}

function canonicalizeHeaders(sheetName, headers) {
    return (headers || []).map(header => canonicalHeader(sheetName, header));
}

function getStructureForSheet(sheet, enabledIndex = -1) {
    const structures = Array.isArray(USER.tableBaseSetting.tableStructure)
        ? USER.tableBaseSetting.tableStructure
        : [];
    return structures.find(item => item.tableName === sheet.name)
        || structures.find(item => item.tableIndex === enabledIndex)
        || null;
}

function getStandardHeaders(sheet, enabledIndex = -1) {
    const canonical = WORLD_MEMORY_HEADERS[sheet?.name];
    if (canonical) return [...canonical];
    const structure = getStructureForSheet(sheet, enabledIndex);
    return Array.isArray(structure?.columns)
        ? structure.columns.map(normalize).filter(Boolean)
        : [];
}

function splitValueSheet(valueSheet, sheetName = '') {
    if (!Array.isArray(valueSheet) || !Array.isArray(valueSheet[0])) {
        return { headers: [], rows: [], hasIndexColumn: true };
    }
    const first = valueSheet[0];
    const hasIndexColumn = first.length > 0 && normalize(first[0]) === '';
    const rawHeaders = (hasIndexColumn ? first.slice(1) : first).map(normalize);
    const headers = canonicalizeHeaders(sheetName, rawHeaders);
    const rows = valueSheet.slice(1).map(row => {
        const source = Array.isArray(row) ? row : [];
        return hasIndexColumn ? source.slice(1) : source.slice();
    });
    return { headers, rawHeaders, rows, hasIndexColumn };
}

function currentSheetSnapshot(sheet) {
    const rawHeaders = (sheet.getHeader?.() || []).map(normalize);
    const headers = canonicalizeHeaders(sheet.name, rawHeaders);
    const valueSheet = sheet.getContent?.(true);
    if (!Array.isArray(valueSheet) || valueSheet.length < 1) return { headers, rawHeaders, rows: [] };
    const parsed = splitValueSheet(valueSheet, sheet.name);
    if (rawHeaders.length && parsed.headers.length !== rawHeaders.length) {
        const rows = valueSheet.slice(1).map(row => {
            const source = Array.isArray(row) ? row : [];
            return source.length === rawHeaders.length + 1 ? source.slice(1) : source.slice(0, rawHeaders.length);
        });
        return { headers, rawHeaders, rows };
    }
    return { headers: headers.length ? headers : parsed.headers, rawHeaders: rawHeaders.length ? rawHeaders : parsed.rawHeaders, rows: parsed.rows };
}

function rowMap(headers, row) {
    const map = new Map();
    headers.forEach((header, index) => {
        if (!header) return;
        // 遇到重复别名映射时，优先保留第一个非空值，避免后续空别名覆盖真实数据。
        const value = row?.[index] ?? '';
        if (!map.has(header) || normalize(map.get(header)) === '') map.set(header, value);
    });
    return map;
}

function findOldRow(sheetName, oldSnapshot, incomingHeaders, incomingRow) {
    const oldRows = oldSnapshot.rows || [];
    if (!oldRows.length) return null;

    // 单行快照表直接沿用最后一条旧快照作为缺列回填来源。
    if (sheetName === '当前状态表') return oldRows[oldRows.length - 1];
    if (sheetName === '角色状态表' && oldRows.length === 1) return oldRows[0];

    const keys = KEY_HEADERS[sheetName] || [];
    if (keys.length) {
        const incoming = rowMap(incomingHeaders, incomingRow);
        const usableKeys = keys.filter(key => incomingHeaders.includes(key) && normalize(incoming.get(key)) !== '');
        if (usableKeys.length) {
            const candidates = oldRows.filter(oldRow => {
                const old = rowMap(oldSnapshot.headers, oldRow);
                return usableKeys.every(key => normalize(old.get(key)) === normalize(incoming.get(key)));
            });
            // 只有唯一命中才允许拿旧行回填。多位同名NPC、同名物品等一律不猜。
            if (candidates.length === 1) return candidates[0];
        }
    }

    return null;
}

/**
 * 将一次“整表重建”的输入限制在当前标准结构内。
 * - 标准列必须存在且按标准顺序排列；
 * - 整理前已经存在的真正自定义附加列保留在末尾；
 * - 已知旧称/误命名会归一到标准列，不会形成重复列；
 * - AI凭空发明的新列不进入正式结构；
 * - AI若漏返回某个旧列，仅在能唯一匹配同一实体时保留旧值。
 */
function conformValueSheetToSchema(sheet, valueSheet, enabledIndex = -1) {
    const standardHeaders = getStandardHeaders(sheet, enabledIndex);
    if (!standardHeaders.length) return valueSheet;

    const oldSnapshot = currentSheetSnapshot(sheet);
    const extraHeaders = (oldSnapshot.rawHeaders || oldSnapshot.headers)
        .filter(header => header && !standardHeaders.includes(canonicalHeader(sheet.name, header)));
    const targetHeaders = [...standardHeaders, ...extraHeaders];
    const incoming = splitValueSheet(valueSheet, sheet.name);
    if (!incoming.headers.length) return valueSheet;

    const projectedRows = incoming.rows.map(row => {
        const incomingValues = rowMap(incoming.headers, row);
        const oldRow = findOldRow(sheet.name, oldSnapshot, incoming.headers, row);
        const oldValues = oldRow ? rowMap(oldSnapshot.headers, oldRow) : new Map();
        return targetHeaders.map(header => {
            const canonical = canonicalHeader(sheet.name, header);
            if (incoming.headers.includes(canonical)) return incomingValues.get(canonical) ?? '';
            return oldValues.get(canonical) ?? '';
        });
    });

    return [
        ['', ...targetHeaders],
        ...projectedRows.map(row => ['', ...row]),
    ];
}

function installWorldMemorySchemaGuard(sheet, enabledIndex = -1) {
    if (!sheet || !WORLD_MEMORY_HEADERS[sheet.name] || guardedSheets.has(sheet)) return false;
    const original = sheet.rebuildHashSheetByValueSheet;
    if (typeof original !== 'function') return false;

    sheet.rebuildHashSheetByValueSheet = function guardedRebuild(valueSheet, ...args) {
        const safeValueSheet = conformValueSheetToSchema(this, valueSheet, enabledIndex);
        return original.call(this, safeValueSheet, ...args);
    };
    guardedSheets.add(sheet);
    return true;
}

function installCurrentWorldMemoryGuards() {
    const sheets = BASE.getChatSheets?.().filter(sheet => sheet?.enable) || [];
    sheets.forEach((sheet, index) => installWorldMemorySchemaGuard(sheet, index));
}

/**
 * 用标准列修复缺失、别名和顺序错误，并安装整表重建保护。
 * notify=true用于“表格整理”按钮场景；普通请求前校验使用notify=false静默处理。
 * 真正的自定义附加列保留在标准列之后。不调用API。
 */
function repairMissingColumnsBeforeCleanup({ notify = true } = {}) {
    const { piece } = USER.getChatPiece() || {};
    if (!piece) return [];

    const sheets = BASE.getChatSheets().filter(sheet => sheet.enable);
    const repaired = [];

    sheets.forEach((sheet, enabledIndex) => {
        const structure = getStructureForSheet(sheet, enabledIndex);
        const standardHeaders = getStandardHeaders(sheet, enabledIndex);
        if (standardHeaders.length === 0) return;

        const rawHeaders = sheet.getHeader().map(normalize);
        const canonicalHeaders = canonicalizeHeaders(sheet.name, rawHeaders);
        const extraHeaders = rawHeaders.filter(header => header && !standardHeaders.includes(canonicalHeader(sheet.name, header)));
        const targetHeaders = [...standardHeaders, ...extraHeaders];
        const missingHeaders = standardHeaders.filter(header => !canonicalHeaders.includes(header));
        const needsRepair = rawHeaders.length !== targetHeaders.length || rawHeaders.some((header, index) => header !== targetHeaders[index]);

        if (needsRepair) {
            const rows = [];
            for (let rowIndex = 1; rowIndex < sheet.getRowCount(); rowIndex++) {
                const cells = sheet.getCellsByRowIndex(rowIndex) || [];
                const sourceValues = cells.slice(1).map(cell => cell?.data?.value ?? '');
                const oldValuesByHeader = rowMap(canonicalHeaders, sourceValues);
                rows.push(targetHeaders.map(header => oldValuesByHeader.get(canonicalHeader(sheet.name, header)) ?? ''));
            }

            const valueSheet = [
                ['', ...targetHeaders],
                ...rows.map(row => ['', ...row]),
            ];

            sheet.rebuildHashSheetByValueSheet(valueSheet);
            sheet.save(piece, true);
            repaired.push({
                tableIndex: structure?.tableIndex ?? enabledIndex,
                tableName: sheet.name,
                missingHeaders,
                reordered: missingHeaders.length === 0,
            });
        }

        installWorldMemorySchemaGuard(sheet, enabledIndex);
    });

    if (repaired.length > 0) {
        BASE.refreshContextView();
        updateSystemMessageTableStatus();
        USER.saveChat();
        console.log('[Memo] 已统一标准表头:', repaired);
        if (notify) {
            const summary = repaired.map(item => {
                if (item.missingHeaders.length) return `${item.tableName}: 补齐/归一 ${item.missingHeaders.join('、')}`;
                return `${item.tableName}: 已恢复标准顺序`;
            }).join('；');
            EDITOR.success(`已统一表头：${summary}`);
        }
    }

    return repaired;
}

export {
    WORLD_MEMORY_HEADERS,
    conformValueSheetToSchema,
    installCurrentWorldMemoryGuards,
    installWorldMemorySchemaGuard,
    repairMissingColumnsBeforeCleanup,
};
