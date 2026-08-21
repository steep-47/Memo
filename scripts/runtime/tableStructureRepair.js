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

function splitValueSheet(valueSheet) {
    if (!Array.isArray(valueSheet) || !Array.isArray(valueSheet[0])) {
        return { headers: [], rows: [], hasIndexColumn: true };
    }
    const first = valueSheet[0];
    const hasIndexColumn = first.length > 0 && normalize(first[0]) === '';
    const headers = (hasIndexColumn ? first.slice(1) : first).map(normalize);
    const rows = valueSheet.slice(1).map(row => {
        const source = Array.isArray(row) ? row : [];
        return hasIndexColumn ? source.slice(1) : source.slice();
    });
    return { headers, rows, hasIndexColumn };
}

function currentSheetSnapshot(sheet) {
    const headers = (sheet.getHeader?.() || []).map(normalize);
    const valueSheet = sheet.getContent?.(true);
    if (!Array.isArray(valueSheet) || valueSheet.length < 1) return { headers, rows: [] };
    const parsed = splitValueSheet(valueSheet);
    // getContent(true)在不同旧版本里可能带或不带内部索引列；优先信任getHeader的真实表头。
    if (headers.length && parsed.headers.length !== headers.length) {
        const rows = valueSheet.slice(1).map(row => {
            const source = Array.isArray(row) ? row : [];
            return source.length === headers.length + 1 ? source.slice(1) : source.slice(0, headers.length);
        });
        return { headers, rows };
    }
    return { headers: headers.length ? headers : parsed.headers, rows: parsed.rows };
}

function rowMap(headers, row) {
    const map = new Map();
    headers.forEach((header, index) => {
        if (header) map.set(header, row?.[index] ?? '');
    });
    return map;
}

function findOldRow(sheetName, oldSnapshot, incomingHeaders, incomingRow, rowIndex) {
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
            const found = oldRows.find(oldRow => {
                const old = rowMap(oldSnapshot.headers, oldRow);
                return usableKeys.every(key => normalize(old.get(key)) === normalize(incoming.get(key)));
            });
            if (found) return found;
        }
    }

    // 无法按实体主键匹配时不猜人物/物品；仅在行数完全一致时允许按原位置保底。
    if (oldRows.length === (rowIndex + 1) || oldRows.length > rowIndex) return oldRows[rowIndex] || null;
    return null;
}

/**
 * 将一次“整表重建”的输入限制在当前标准结构内。
 * - 标准列必须存在且按标准顺序排列；
 * - 整理前已经存在的自定义附加列保留在末尾；
 * - AI凭空发明的新列不进入正式结构；
 * - AI若漏返回某个旧列，能按同一实体匹配时保留旧值，尤其保护NPC长期锚点。
 */
function conformValueSheetToSchema(sheet, valueSheet, enabledIndex = -1) {
    const standardHeaders = getStandardHeaders(sheet, enabledIndex);
    if (!standardHeaders.length) return valueSheet;

    const oldSnapshot = currentSheetSnapshot(sheet);
    const extraHeaders = oldSnapshot.headers.filter(header => header && !standardHeaders.includes(header));
    const targetHeaders = [...standardHeaders, ...extraHeaders];
    const incoming = splitValueSheet(valueSheet);
    if (!incoming.headers.length) return valueSheet;

    const projectedRows = incoming.rows.map((row, rowIndex) => {
        const incomingValues = rowMap(incoming.headers, row);
        const oldRow = findOldRow(sheet.name, oldSnapshot, incoming.headers, row, rowIndex);
        const oldValues = oldRow ? rowMap(oldSnapshot.headers, oldRow) : new Map();
        return targetHeaders.map(header => {
            // 只有“整列没有返回”才用旧锚点回填；若AI明确返回了该列且值为空，则尊重其清空结果。
            if (incoming.headers.includes(header)) return incomingValues.get(header) ?? '';
            return oldValues.get(header) ?? '';
        });
    });

    return [
        ['', ...targetHeaders],
        ...projectedRows.map(row => ['', ...row]),
    ];
}

/**
 * 给当前世界状态Sheet安装结构保护。任何通过rebuildHashSheetByValueSheet进行的整表重建
 * 都先经过标准列对齐，因此“表格整理”等功能不能再把标准表头删掉或改名。
 * 只保护六张已知世界状态表；其他自定义表完全不受影响。
 */
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
 * 在“表格整理”开始前，用标准列修复缺失表头，并安装整表重建保护。
 * 只补缺失列；已有额外自定义列保留，现有数据按列名重新对齐。
 * 不调用 API，不参与普通自动填表链。
 */
function repairMissingColumnsBeforeCleanup() {
    const { piece } = USER.getChatPiece() || {};
    if (!piece) return [];

    const sheets = BASE.getChatSheets().filter(sheet => sheet.enable);
    const repaired = [];

    sheets.forEach((sheet, enabledIndex) => {
        const structure = getStructureForSheet(sheet, enabledIndex);
        const standardHeaders = getStandardHeaders(sheet, enabledIndex);
        if (standardHeaders.length === 0) return;

        const currentHeaders = sheet.getHeader().map(normalize);
        const missingHeaders = standardHeaders.filter(header => !currentHeaders.includes(header));
        if (missingHeaders.length > 0) {
            const extraHeaders = currentHeaders.filter(header => header && !standardHeaders.includes(header));
            const targetHeaders = [...standardHeaders, ...extraHeaders];

            const rows = [];
            for (let rowIndex = 1; rowIndex < sheet.getRowCount(); rowIndex++) {
                const cells = sheet.getCellsByRowIndex(rowIndex) || [];
                const oldValuesByHeader = new Map();
                currentHeaders.forEach((header, colIndex) => {
                    if (!header) return;
                    oldValuesByHeader.set(header, cells[colIndex + 1]?.data?.value ?? '');
                });
                rows.push(targetHeaders.map(header => oldValuesByHeader.get(header) ?? ''));
            }

            const valueSheet = [
                ['', ...targetHeaders],
                ...rows.map(row => ['', ...row]),
            ];

            // 此处先用原方法完成一次确定性的缺列修复，再安装guard，避免guard套guard。
            sheet.rebuildHashSheetByValueSheet(valueSheet);
            sheet.save(piece, true);
            repaired.push({
                tableIndex: structure?.tableIndex ?? enabledIndex,
                tableName: sheet.name,
                missingHeaders,
            });
        }

        installWorldMemorySchemaGuard(sheet, enabledIndex);
    });

    if (repaired.length > 0) {
        BASE.refreshContextView();
        updateSystemMessageTableStatus();
        USER.saveChat();
        console.log('[Memo] 表格整理前已修复缺失表头:', repaired);
        const summary = repaired
            .map(item => `${item.tableName}: ${item.missingHeaders.join('、')}`)
            .join('；');
        EDITOR.success(`已修复缺失表头：${summary}`);
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
