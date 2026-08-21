import { BASE, USER } from '../../core/manager.js';
import { SheetBase } from '../../core/table/base.js';
import { defaultSettings } from '../../data/pluginSetting.js';

const STANDARD_NAMES = ['当前状态表','角色状态表','背包表','当前任务与约定表','人物主表','人物发展表','历史事件表'];
const LEGACY_PERSON_NAME = '人物表';
const MAIN_COLUMNS = ['姓名','性别','别名/称呼','身份/所属','外貌特征','性格','与玩家关系','重要信息'];
const DEV_COLUMNS = ['姓名','修为','主要能力','当前地点','年龄/最后确认时间','当前状态','主要目标/重要事项'];

function norm(v) { return String(v ?? '').trim(); }
function clone(v) {
    if (v === null || typeof v !== 'object') return v;
    try { return structuredClone(v); } catch (_) { return JSON.parse(JSON.stringify(v)); }
}

function canonicalStructures() {
    return defaultSettings.tableStructure.map(item => clone(item));
}

function normalizeSettingsStructure(settings = USER.tableBaseSetting) {
    const existing = Array.isArray(settings.tableStructure) ? settings.tableStructure : [];
    const standardOrLegacy = new Set([...STANDARD_NAMES, LEGACY_PERSON_NAME]);
    const custom = existing.filter(item => item && !standardOrLegacy.has(item.tableName));
    const next = canonicalStructures();
    custom.forEach((item, offset) => next.push({ ...clone(item), tableIndex: 7 + offset }));
    const same = JSON.stringify(existing) === JSON.stringify(next);
    if (!same) settings.tableStructure = next;
    return !same;
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
    return rows
        .map(row => {
            const m = mapRow(headers, row);
            return columns.map(col => m.get(col) ?? '');
        })
        .filter(row => norm(row[0]));
}

function createSheetFromStructure(structure, rows = []) {
    const cols = structure.columns.length + 1;
    const newSheet = BASE.createChatSheet(cols, Math.max(1, rows.length + 1));
    newSheet.name = structure.tableName;
    newSheet.domain = SheetBase.SheetDomain.chat;
    newSheet.type = SheetBase.SheetType.dynamic;
    newSheet.enable = structure.enable !== false;
    newSheet.required = structure.Required === true;
    newSheet.tochat = structure.toChat !== false;
    newSheet.sendToContext = true;
    newSheet.triggerSend = false;
    newSheet.triggerSendDeep = 1;
    const valueSheet = [['', ...structure.columns], ...rows.map(row => ['', ...row])];
    newSheet.rebuildHashSheetByValueSheet(valueSheet);
    if (newSheet.data) {
        newSheet.data.note = structure.note || '';
        newSheet.data.initNode = structure.initNode || '';
        newSheet.data.insertNode = structure.insertNode || '';
        newSheet.data.updateNode = structure.updateNode || '';
        newSheet.data.deleteNode = structure.deleteNode || '';
        newSheet.data.description = [structure.note, structure.initNode, structure.insertNode, structure.updateNode, structure.deleteNode].filter(Boolean).join('\n');
    }
    return newSheet;
}

function ensureCanonicalSheet(existingSheets, name, rows = []) {
    const found = existingSheets.find(sheet => sheet?.name === name);
    if (found) return found;
    const structure = USER.tableBaseSetting.tableStructure.find(item => item.tableName === name);
    return structure ? createSheetFromStructure(structure, rows) : null;
}

function migrateCurrentChatSheets() {
    const { piece } = USER.getChatPiece() || {};
    if (!piece) return false;
    const sheets = BASE.getChatSheets();
    if (!sheets.length) return false;

    const legacy = sheets.find(sheet => sheet?.name === LEGACY_PERSON_NAME);
    let main = sheets.find(sheet => sheet?.name === '人物主表');
    let dev = sheets.find(sheet => sheet?.name === '人物发展表');
    let changed = false;

    if (legacy) {
        if (!main) {
            main = ensureCanonicalSheet(sheets, '人物主表', projectLegacyPerson(legacy, MAIN_COLUMNS));
            changed = !!main || changed;
        }
        if (!dev) {
            dev = ensureCanonicalSheet(sheets, '人物发展表', projectLegacyPerson(legacy, DEV_COLUMNS));
            changed = !!dev || changed;
        }
    } else {
        if (!main) { main = ensureCanonicalSheet(sheets, '人物主表', []); changed = !!main || changed; }
        if (!dev) { dev = ensureCanonicalSheet(sheets, '人物发展表', []); changed = !!dev || changed; }
    }

    const refreshed = BASE.getChatSheets();
    const byName = new Map(refreshed.map(sheet => [sheet.name, sheet]));
    const canonical = STANDARD_NAMES.map(name => byName.get(name)).filter(Boolean);
    const canonicalSet = new Set(STANDARD_NAMES);
    const custom = refreshed.filter(sheet => sheet && !canonicalSet.has(sheet.name) && sheet.name !== LEGACY_PERSON_NAME);
    const ordered = [...canonical, ...custom];

    const currentEnabledNames = refreshed.filter(s => s?.enable).map(s => s.name);
    const targetEnabledNames = canonical.filter(s => s?.enable).map(s => s.name);
    const needsReorder = targetEnabledNames.some((name, i) => currentEnabledNames[i] !== name) || !!legacy;

    if (changed || needsReorder) {
        BASE.reSaveAllChatSheets(ordered);
        if (legacy?.uid && piece.hash_sheets) delete piece.hash_sheets[legacy.uid];
        USER.saveChat();
        BASE.refreshContextView?.();
        BASE.refreshTempView?.(true);
        console.log('[Memo] 六表→七表迁移完成：人物主表/人物发展表已拆分，历史事件表移动到#6');
        return true;
    }
    return false;
}

function ensureSevenTableWorld() {
    const settingsChanged = normalizeSettingsStructure();
    const dataChanged = migrateCurrentChatSheets();
    if (settingsChanged) USER.saveSettings?.();
    return settingsChanged || dataChanged;
}

export {
    STANDARD_NAMES,
    MAIN_COLUMNS,
    DEV_COLUMNS,
    normalizeSettingsStructure,
    migrateCurrentChatSheets,
    ensureSevenTableWorld,
};
