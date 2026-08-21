import { BASE, USER } from '../../core/manager.js';
import { SheetBase } from '../../core/table/base.js';
import { defaultSettings } from '../../data/pluginSetting.js';

const STANDARD_NAMES = ['当前状态表','角色状态表','背包表','当前任务与约定表','人物主表','人物发展表','历史事件表'];
const LEGACY_PERSON_NAME = '人物表';
const STANDARD_OR_LEGACY_NAMES = new Set([...STANDARD_NAMES, LEGACY_PERSON_NAME]);
const MAIN_COLUMNS = ['姓名','性别','别名/称呼','身份/所属','外貌特征','性格','与玩家关系','重要信息'];
const DEV_COLUMNS = ['姓名','修为','主要能力','当前地点','年龄','最后确认时间','当前状态','主要目标/重要事项'];

function norm(v) { return String(v ?? '').trim(); }
function clone(v) {
    if (v === null || typeof v !== 'object') return v;
    try { return structuredClone(v); } catch (_) { return JSON.parse(JSON.stringify(v)); }
}
function canonicalStructures() {
    const structures = defaultSettings.tableStructure.map(item => clone(item));
    for (const item of structures) {
        if (!STANDARD_NAMES.includes(item?.tableName)) continue;
        item.enable = true;
        item.toChat = true;
        item.tochat = true;
    }
    const dev = structures.find(item => item?.tableName === '人物发展表');
    if (dev) {
        dev.columns = [...DEV_COLUMNS];
        dev.note = 'NPC专属最新发展锚点表；年龄与最后确认时间分列；同一NPC一行；只保存最后有效状态，不记录离线流水账';
        dev.initNode = '值得长期追踪的NPC出现已确认发展信息时记录；姓名用于与人物主表关联，其余未知留空';
        dev.insertNode = '人物发展表中尚无该NPC且已确认至少一项发展状态时插入；不得为了成长而编造信息';
        dev.updateNode = '新确认的修为/能力/地点/年龄/最后确认时间/重要状态/目标覆盖对应旧锚点；年龄是人物属性，最后确认时间是该锚点被确认的世界时间，二者不得混写';
    }
    return structures;
}

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
    } catch (_) { return norm(raw?.name || raw?.source?.name); }
}
function templateColumns(raw) {
    try {
        if (!raw?.uid) return [];
        const t = new BASE.SheetTemplate(raw.uid);
        const row = Array.isArray(t.hashSheet?.[0]) ? t.hashSheet[0] : [];
        return row.slice(1).map(cellUid => norm(t.cells?.get?.(cellUid)?.data?.value));
    } catch (_) { return []; }
}
function setIfDifferent(target, key, value) {
    if (target?.[key] === value) return false;
    target[key] = value;
    return true;
}
function syncRuleData(target, structure) {
    if (!target) return false;
    let changed = false;
    const values = {
        note: structure.note || '',
        initNode: structure.initNode || '',
        insertNode: structure.insertNode || '',
        updateNode: structure.updateNode || '',
        deleteNode: structure.deleteNode || '',
    };
    for (const [key, value] of Object.entries(values)) changed = setIfDifferent(target, key, value) || changed;
    const description = [values.note, values.initNode, values.insertNode, values.updateNode, values.deleteNode].filter(Boolean).join('\n');
    changed = setIfDifferent(target, 'description', description) || changed;
    return changed;
}
function applyStructureMetadata(target, structure) {
    if (!target || !structure) return false;
    let changed = false;
    changed = setIfDifferent(target, 'enable', true) || changed;
    changed = setIfDifferent(target, 'required', structure.Required === true) || changed;
    changed = setIfDifferent(target, 'tochat', structure.tochat ?? structure.toChat ?? true) || changed;
    changed = setIfDifferent(target, 'sendToContext', true) || changed;
    changed = setIfDifferent(target, 'triggerSend', structure.triggerSend ?? false) || changed;
    changed = setIfDifferent(target, 'triggerSendDeep', structure.triggerSendDeep ?? 1) || changed;
    if (target.source?.data) changed = syncRuleData(target.source.data, structure) || changed;
    return changed;
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
    applyStructureMetadata(t, structure);
    if (structure.config) t.config = clone(structure.config);
    t.save();
    return t;
}
function syncExistingGlobalTemplates(rawTemplates, canonicalDefs) {
    let changed = false;
    for (let i = 0; i < STANDARD_NAMES.length; i++) {
        const raw = rawTemplates[i];
        if (!raw?.uid) continue;
        try {
            const t = new BASE.SheetTemplate(raw.uid);
            if (applyStructureMetadata(t, canonicalDefs[i])) {
                t.save();
                changed = true;
            }
        } catch (error) {
            console.warn(`[Memo] 同步全局模板 ${STANDARD_NAMES[i]} 规则失败`, error);
        }
    }
    return changed;
}
function syncGlobalTemplates() {
    const root = USER.getSettings();
    if (!root) return false;
    const rawTemplates = Array.isArray(root.table_database_templates) ? root.table_database_templates : [];
    const names = rawTemplates.map(templateName);
    const canonicalDefs = canonicalStructures();
    const canonicalValid = STANDARD_NAMES.every((name, i) => names[i] === name && JSON.stringify(templateColumns(rawTemplates[i])) === JSON.stringify(canonicalDefs[i]?.columns || []));

    if (canonicalValid && !names.includes(LEGACY_PERSON_NAME)) {
        let changed = syncExistingGlobalTemplates(rawTemplates, canonicalDefs);
        const standardUids = rawTemplates.slice(0, STANDARD_NAMES.length).map(raw => raw?.uid).filter(Boolean);
        const customUids = rawTemplates.slice(STANDARD_NAMES.length).filter(raw => raw?.uid).map(raw => raw.uid);
        const selected = [...standardUids, ...customUids.filter(uid => root.table_selected_sheets?.includes(uid))];
        if (JSON.stringify(root.table_selected_sheets || []) !== JSON.stringify(selected)) {
            root.table_selected_sheets = selected;
            changed = true;
        }
        if (changed) USER.saveSettings?.();
        return changed;
    }

    const customRaw = rawTemplates.filter((raw, i) => !STANDARD_OR_LEGACY_NAMES.has(names[i]));
    root.table_database_templates = [];
    root.table_selected_sheets = [];
    canonicalDefs.forEach(structure => {
        const t = createGlobalTemplate(structure);
        root.table_selected_sheets.push(t.uid);
    });
    for (const raw of customRaw) {
        root.table_database_templates.push(raw);
        try { const t = raw?.uid ? new BASE.SheetTemplate(raw.uid) : null; if (t?.enable !== false && raw?.uid) root.table_selected_sheets.push(raw.uid); } catch (_) {}
    }
    USER.saveSettings?.();
    console.log('[Memo] 全局模板已同步为七表结构与最新标准规则，自定义附加模板已保留');
    return true;
}

function valueRows(sheet) {
    const headers = (sheet?.getHeader?.() || []).map(norm);
    const values = sheet?.getContent?.(true);
    if (!Array.isArray(values) || values.length < 1) return { headers, rows: [] };
    const rows = values.slice(1).map(row => { const raw = Array.isArray(row) ? row : []; return raw.length === headers.length + 1 ? raw.slice(1) : raw.slice(0, headers.length); });
    return { headers, rows };
}
function mapRow(headers, row) {
    const m = new Map();
    headers.forEach((h, i) => { if (h && (!m.has(h) || !norm(m.get(h)))) m.set(h, row?.[i] ?? ''); });
    return m;
}
function splitLegacyAgeAnchor(raw) {
    const value = norm(raw);
    if (!value) return { age:'', confirmed:'' };
    const ageOnly = /^(?:约|大约|年约)?\s*\d+(?:\.\d+)?\s*岁$/;
    const timeLike = /(?:\d{3,6}年(?:\d{1,2}月(?:\d{1,2}日)?)?|\d{2,6}[-/.]\d{1,2}(?:[-/.]\d{1,2})?|\d{1,2}:\d{2}|苍玄历|公元|纪元|历\s*\d+)/;
    if (ageOnly.test(value)) return { age:value, confirmed:'' };
    if (timeLike.test(value) && !/\d+\s*岁/.test(value)) return { age:'', confirmed:value };
    const ageMatch = value.match(/(?:^|[｜|,，;；\s])((?:约|大约)?\s*\d+(?:\.\d+)?\s*岁)(?=$|[｜|,，;；\s])/);
    if (ageMatch) {
        const rest = value.replace(ageMatch[0], ' ').replace(/^[｜|,，;；\s]+|[｜|,，;；\s]+$/g,'').trim();
        return { age:ageMatch[1].trim(), confirmed:rest };
    }
    return { age:'', confirmed:value };
}
function projectLegacyPerson(sheet, columns) {
    const { headers, rows } = valueRows(sheet);
    return rows.map(row => {
        const m = mapRow(headers, row);
        return columns.map(col => {
            if (col === '年龄') return m.get('年龄') ?? splitLegacyAgeAnchor(m.get('年龄/最后确认时间')).age;
            if (col === '最后确认时间') return m.get('最后确认时间') ?? splitLegacyAgeAnchor(m.get('年龄/最后确认时间')).confirmed;
            return m.get(col) ?? '';
        });
    }).filter(row => norm(row[0]));
}
function projectExistingDevelopment(sheet) {
    const { headers, rows } = valueRows(sheet);
    if (!headers.includes('年龄/最后确认时间')) return [];
    return rows.map(row => {
        const m = mapRow(headers,row);
        const split = splitLegacyAgeAnchor(m.get('年龄/最后确认时间'));
        return DEV_COLUMNS.map(col => col === '年龄' ? split.age : col === '最后确认时间' ? split.confirmed : (m.get(col) ?? ''));
    }).filter(row => norm(row[0]));
}
function mergeProjectedRows(sheet, columns, projectedRows, piece) {
    if (!sheet || !projectedRows.length) return false;
    const { headers, rows } = valueRows(sheet);
    const currentColumns = headers.length ? headers : columns;
    const normalizedRows = rows.map(row => { const m = mapRow(currentColumns, row); return columns.map(col => m.get(col) ?? ''); });
    let changed = false;
    for (const incoming of projectedRows) {
        const name = norm(incoming[0]); if (!name) continue;
        const candidates = normalizedRows.map((row,index)=>({row,index})).filter(item=>norm(item.row[0])===name);
        if (!candidates.length) { normalizedRows.push([...incoming]); changed = true; continue; }
        if (candidates.length !== 1) continue;
        const target = candidates[0].row;
        for (let i=1;i<columns.length;i++) if (!norm(target[i]) && norm(incoming[i])) { target[i]=incoming[i]; changed=true; }
    }
    if (changed) {
        sheet.rebuildHashSheetByValueSheet([['',...columns],...normalizedRows.map(row=>['',...row])]);
        if (piece) sheet.save(piece,true);
    }
    return changed;
}
function createSheetFromStructure(structure, rows=[], piece=null) {
    const newSheet = BASE.createChatSheet(structure.columns.length+1, Math.max(1,rows.length+1));
    newSheet.name=structure.tableName; newSheet.domain=SheetBase.SheetDomain.chat; newSheet.type=SheetBase.SheetType.dynamic;
    applyStructureMetadata(newSheet, structure);
    newSheet.rebuildHashSheetByValueSheet([['',...structure.columns],...rows.map(row=>['',...row])]);
    if (newSheet.data) syncRuleData(newSheet.data, structure);
    if(piece)newSheet.save(piece,true); return newSheet;
}
function ensureCanonicalSheet(existingSheets,name,rows,piece){ const found=existingSheets.find(sheet=>sheet?.name===name); if(found)return found; const structure=USER.tableBaseSetting.tableStructure.find(item=>item.tableName===name); return structure?createSheetFromStructure(structure,rows,piece):null; }

function normalizeStandardSheets(sheets, piece) {
    let changed = false;
    const structures = canonicalStructures();
    for (let i = 0; i < STANDARD_NAMES.length; i++) {
        const sheet = sheets.find(item => item?.name === STANDARD_NAMES[i]);
        if (!sheet) continue;
        if (applyStructureMetadata(sheet, structures[i])) {
            sheet.save(piece, true);
            changed = true;
        }
    }
    return changed;
}

function migrateCurrentChatSheets() {
    const {piece}=USER.getChatPiece()||{}; if(!piece)return false;
    let sheets=BASE.getChatSheets(); if(!sheets.length)return false;
    const legacy=sheets.find(sheet=>sheet?.name===LEGACY_PERSON_NAME);
    const oldDev=sheets.find(sheet=>sheet?.name==='人物发展表');
    const projectedMain=legacy?projectLegacyPerson(legacy,MAIN_COLUMNS):[];
    const projectedDev=legacy?projectLegacyPerson(legacy,DEV_COLUMNS):[];
    const projectedOldDev=oldDev?projectExistingDevelopment(oldDev):[];
    let changed=normalizeStandardSheets(sheets,piece);
    for(const name of STANDARD_NAMES){
        sheets=BASE.getChatSheets(); if(sheets.some(sheet=>sheet?.name===name))continue;
        const seedRows=name==='人物主表'?projectedMain:name==='人物发展表'?projectedDev:[];
        const created=ensureCanonicalSheet(sheets,name,seedRows,piece); changed=!!created||changed;
    }
    const current=BASE.getChatSheets();
    changed=normalizeStandardSheets(current,piece)||changed;
    if(legacy){ changed=mergeProjectedRows(current.find(s=>s?.name==='人物主表'),MAIN_COLUMNS,projectedMain,piece)||changed; changed=mergeProjectedRows(current.find(s=>s?.name==='人物发展表'),DEV_COLUMNS,projectedDev,piece)||changed; }
    if(projectedOldDev.length){
        const dev=current.find(s=>s?.name==='人物发展表');
        changed=mergeProjectedRows(dev,DEV_COLUMNS,projectedOldDev,piece)||changed;
    }
    const refreshed=BASE.getChatSheets(); const byName=new Map(refreshed.map(sheet=>[sheet.name,sheet]));
    const canonical=STANDARD_NAMES.map(name=>byName.get(name)).filter(Boolean); const canonicalSet=new Set(STANDARD_NAMES);
    const custom=refreshed.filter(sheet=>sheet&&!canonicalSet.has(sheet.name)&&sheet.name!==LEGACY_PERSON_NAME); const ordered=[...canonical,...custom];
    const currentNames=refreshed.filter(s=>s?.name!==LEGACY_PERSON_NAME).map(s=>s.name); const targetNames=ordered.map(s=>s?.name);
    const needsReorder=currentNames.length!==targetNames.length||targetNames.some((name,i)=>currentNames[i]!==name)||!!legacy;
    if(changed||needsReorder){ BASE.reSaveAllChatSheets(ordered); if(legacy?.uid&&piece.hash_sheets)delete piece.hash_sheets[legacy.uid]; USER.saveChat(); BASE.refreshContextView?.(); BASE.refreshTempView?.(true); console.log('[Memo] 世界状态表已统一为七表：固定启用/索引/上下文发送/标准规则元数据；人物发展年龄与确认时间分列'); return true; }
    return false;
}
function ensureSevenTableWorld(){ const settingsChanged=normalizeSettingsStructure(); const templatesChanged=syncGlobalTemplates(); const dataChanged=migrateCurrentChatSheets(); if(settingsChanged)USER.saveSettings?.(); return settingsChanged||templatesChanged||dataChanged; }
export { STANDARD_NAMES, MAIN_COLUMNS, DEV_COLUMNS, normalizeSettingsStructure, syncGlobalTemplates, migrateCurrentChatSheets, ensureSevenTableWorld };
