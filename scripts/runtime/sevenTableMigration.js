import { BASE, USER } from '../../core/manager.js';
import { SheetBase } from '../../core/table/base.js';
import { defaultSettings } from '../../data/pluginSetting.js';

const STANDARD_NAMES = ['当前状态表','角色状态表','背包表','当前任务与约定表','人物主表','人物发展表','历史事件表'];
const LEGACY_PERSON_NAME = '人物表';
const STANDARD_OR_LEGACY_NAMES = new Set([...STANDARD_NAMES, LEGACY_PERSON_NAME]);
const MAIN_COLUMNS = ['姓名','性别','别名/称呼','身份/所属','外貌特征','性格','与玩家关系','重要信息'];
const DEV_COLUMNS = ['姓名','修为','主要能力','当前地点','年龄/最后确认时间','当前状态','主要目标/重要事项'];

function norm(v) { return String(v ?? '').trim(); }
function clone(v) {
    if (v === null || typeof v !== 'object') return v;
    try { return structuredClone(v); } catch (_) { return JSON.parse(JSON.stringify(v)); }
}
function canonicalStructures() { return defaultSettings.tableStructure.map(item => clone(item)); }

function normalizeSettingsStructure(settings = USER.tableBaseSetting) {
    const existing = Array.isArray(settings.tableStructure) ? settings.tableStructure : [];
    const custom = existing.filter(item => item && !STANDARD_OR_LEGACY_NAMES.has(item.tableName));
    const next = canonicalStructures();
    custom.forEach((item, offset) => next.push({ ...clone(item), tableIndex: 7 + offset }));
    const same = JSON.stringify(existing) === JSON.stringify(next);
    if (!same) settings.tableStructure = next;
    return !same;
}

function templateName(raw) {
    try {
        if (!raw?.uid) return norm(raw?.name || raw?.source?.name);
        return norm(new BASE.SheetTemplate(raw.uid).name);
    } catch (_) {
        return norm(raw?.name || raw?.source?.name);
    }
}

function templateColumns(raw) {
    try {
        if (!raw?.uid) return [];
        const t = new BASE.SheetTemplate(raw.uid);
        const row = Array.isArray(t.hashSheet?.[0]) ? t.hashSheet[0] : [];
        return row.slice(1).map(cellUid => norm(t.cells?.get?.(cellUid)?.data?.value));
    } catch (_) {
        return [];
    }
}

function createGlobalTemplate(structure) {
    const t = new BASE.SheetTemplate();
    t.domain = 'global';
    t.createNewTemplate(structure.columns.length + 1, 1, false);
    t.name = structure.tableName;
    structure.columns.forEach((column, index) => {
        const cell = t.findCellByPosition(0, index + 1);
        if (cell) cell.data.value = column;
    });
    t.enable = structure.enable !== false;
    t.tochat = structure.tochat ?? structure.toChat ?? true;
    t.required = structure.Required === true;
    t.triggerSend = structure.triggerSend;
    t.triggerSendDeep = structure.triggerSendDeep;
    if (structure.config) t.config = clone(structure.config);
    if (t.source?.data) {
        t.source.data.note = structure.note || '';
        t.source.data.initNode = structure.initNode || '';
        t.source.data.deleteNode = structure.deleteNode || '';
        t.source.data.updateNode = structure.updateNode || '';
        t.source.data.insertNode = structure.insertNode || '';
    }
    t.save();
    return t;
}

function syncGlobalTemplates() {
    const root = USER.getSettings();
    if (!root) return false;
    const rawTemplates = Array.isArray(root.table_database_templates) ? root.table_database_templates : [];
    const names = rawTemplates.map(templateName);
    const canonicalDefs = canonicalStructures();
    const canonicalValid = STANDARD_NAMES.every((name, i) => {
        if (names[i] !== name) return false;
        const actual = templateColumns(rawTemplates[i]);
        return JSON.stringify(actual) === JSON.stringify(canonicalDefs[i]?.columns || []);
    });
    if (canonicalValid && !names.includes(LEGACY_PERSON_NAME)) return false;

    const customRaw = rawTemplates.filter((raw, i) => !STANDARD_OR_LEGACY_NAMES.has(names[i]));
    root.table_database_templates = [];
    root.table_selected_sheets = [];

    canonicalDefs.forEach(structure => {
        const t = createGlobalTemplate(structure);
        if (t.enable !== false) root.table_selected_sheets.push(t.uid);
    });

    for (const raw of customRaw) {
        root.table_database_templates.push(raw);
        try {
            const t = raw?.uid ? new BASE.SheetTemplate(raw.uid) : null;
            if (t?.enable !== false && raw?.uid) root.table_selected_sheets.push(raw.uid);
        } catch (_) {}
    }
    USER.saveSettings?.();
    console.log('[Memo] 全局模板已同步为七表结构，自定义附加模板已保留');
    return true;
}

function valueRows(sheet) {
    const headers = (sheet?.getHeader?.() || []).map(norm);
    const values = sheet?.getContent?.(true);
    if (!Array.isArray(values) || values.length < 1) return { headers, rows: [] };
    const rows = values.slice(1).map(row => {
        const raw = Array.isArray(row) ? row : [];
        return raw.length === headers.length + 1 ? raw.slice(1) : raw.slice(0, headers.length);
    });
    return { headers, rows };
}

function mapRow(headers, row) {
    const m = new Map();
    headers.forEach((h, i) => { if (h && (!m.has(h) || !norm(m.get(h)))) m.set(h, row?.[i] ?? ''); });
    return m;
}

function projectLegacyPerson(sheet, columns) {
    const { headers, rows } = valueRows(sheet);
    return rows.map(row => {
        const m = mapRow(headers, row);
        return columns.map(col => m.get(col) ?? '');
    }).filter(row => norm(row[0]));
}

function createSheetFromStructure(structure, rows = [], piece = null) {
    const newSheet = BASE.createChatSheet(structure.columns.length + 1, Math.max(1, rows.length + 1));
    newSheet.name = structure.tableName;
    newSheet.domain = SheetBase.SheetDomain.chat;
    newSheet.type = SheetBase.SheetType.dynamic;
    newSheet.enable = structure.enable !== false;
    newSheet.required = structure.Required === true;
    newSheet.tochat = structure.tochat ?? structure.toChat ?? true;
    newSheet.sendToContext = true;
    newSheet.triggerSend = false;
    newSheet.triggerSendDeep = 1;
    newSheet.rebuildHashSheetByValueSheet([['', ...structure.columns], ...rows.map(row => ['', ...row])]);
    if (newSheet.data) {
        newSheet.data.note = structure.note || '';
        newSheet.data.initNode = structure.initNode || '';
        newSheet.data.insertNode = structure.insertNode || '';
        newSheet.data.updateNode = structure.updateNode || '';
        newSheet.data.deleteNode = structure.deleteNode || '';
        newSheet.data.description = [structure.note, structure.initNode, structure.insertNode, structure.updateNode, structure.deleteNode].filter(Boolean).join('\n');
    }
    if (piece) newSheet.save(piece, true);
    return newSheet;
}

function ensureCanonicalSheet(existingSheets, name, rows, piece) {
    const found = existingSheets.find(sheet => sheet?.name === name);
    if (found) return found;
    const structure = USER.tableBaseSetting.tableStructure.find(item => item.tableName === name);
    return structure ? createSheetFromStructure(structure, rows, piece) : null;
}

function migrateCurrentChatSheets() {
    const { piece } = USER.getChatPiece() || {};
    if (!piece) return false;
    let sheets = BASE.getChatSheets();
    if (!sheets.length) return false;

    const legacy = sheets.find(sheet => sheet?.name === LEGACY_PERSON_NAME);
    const projectedMain = legacy ? projectLegacyPerson(legacy, MAIN_COLUMNS) : [];
    const projectedDev = legacy ? projectLegacyPerson(legacy, DEV_COLUMNS) : [];
    let changed = false;

    for (const name of STANDARD_NAMES) {
        sheets = BASE.getChatSheets();
        if (sheets.some(sheet => sheet?.name === name)) continue;
        const seedRows = name === '人物主表' ? projectedMain : name === '人物发展表' ? projectedDev : [];
        const created = ensureCanonicalSheet(sheets, name, seedRows, piece);
        changed = !!created || changed;
    }

    const refreshed = BASE.getChatSheets();
    const byName = new Map(refreshed.map(sheet => [sheet.name, sheet]));
    const canonical = STANDARD_NAMES.map(name => byName.get(name)).filter(Boolean);
    const canonicalSet = new Set(STANDARD_NAMES);
    const custom = refreshed.filter(sheet => sheet && !canonicalSet.has(sheet.name) && sheet.name !== LEGACY_PERSON_NAME);
    const ordered = [...canonical, ...custom];

    const currentEnabledNames = refreshed.filter(s => s?.enable && s?.name !== LEGACY_PERSON_NAME).map(s => s.name);
    const targetEnabledNames = ordered.filter(s => s?.enable).map(s => s.name);
    const needsReorder = currentEnabledNames.length !== targetEnabledNames.length
        || targetEnabledNames.some((name, i) => currentEnabledNames[i] !== name)
        || !!legacy;

    if (changed || needsReorder) {
        BASE.reSaveAllChatSheets(ordered);
        if (legacy?.uid && piece.hash_sheets) delete piece.hash_sheets[legacy.uid];
        USER.saveChat();
        BASE.refreshContextView?.();
        BASE.refreshTempView?.(true);
        console.log('[Memo] 世界状态表已统一为七表：人物主表/人物发展表分离，历史事件表为#6');
        return true;
    }
    return false;
}

function ensureSevenTableWorld() {
    const settingsChanged = normalizeSettingsStructure();
    const templatesChanged = syncGlobalTemplates();
    const dataChanged = migrateCurrentChatSheets();
    if (settingsChanged) USER.saveSettings?.();
    return settingsChanged || templatesChanged || dataChanged;
}

export { STANDARD_NAMES, MAIN_COLUMNS, DEV_COLUMNS, normalizeSettingsStructure, syncGlobalTemplates, migrateCurrentChatSheets, ensureSevenTableWorld };
