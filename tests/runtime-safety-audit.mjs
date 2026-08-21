import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

let source = await fs.readFile(new URL('../scripts/runtime/safeTableExecutor.js', import.meta.url), 'utf8');
const json5Url = pathToFileURL(new URL('../utils/json5.min.mjs', import.meta.url).pathname).href;
source = source
    .replace("import { BASE, USER } from '../../core/manager.js';", 'const { BASE, USER } = globalThis.__memoMocks;')
    .replace("import { Cell } from '../../core/table/cell.js';", 'const { Cell } = globalThis.__memoMocks;')
    .replace("import JSON5 from '../../utils/json5.min.mjs';", `import JSON5 from '${json5Url}';`);

class FakeSheet {
    constructor(name, rows = [['', 'h0', 'h1'], ['', 'a', 'b']]) {
        this.name = name;
        this.uid = name;
        this.enable = true;
        this.sendToContext = true;
        this.rows = structuredClone(rows);
        this.failSave = false;
    }
    getHeader() { return this.rows[0].slice(1); }
    getRowCount() { return this.rows.length; }
    getCellsByRowIndex(row) { return this.rows[row]?.map((_, column) => this.cell(row, column)); }
    findCellByPosition(row, column) { return this.rows[row] && column < this.rows[row].length ? this.cell(row, column) : null; }
    cell(row, column) {
        const sheet = this;
        return {
            data: {
                get value() { return sheet.rows[row][column]; },
                set value(value) { sheet.rows[row][column] = value; },
            },
            newAction(action, payload) {
                if (action === 'edit') sheet.rows[row][column] = payload.value;
                else if (action === 'insert') sheet.rows.splice(row + 1, 0, new Array(sheet.rows[0].length).fill(''));
                else if (action === 'delete') sheet.rows.splice(row, 1);
            },
        };
    }
    filterSavingData() { return { rows: structuredClone(this.rows), name: this.name }; }
    loadJson(data) { this.rows = structuredClone(data.rows); }
    save(piece) {
        if (this.failSave) return false;
        piece.hash_sheets ??= {};
        piece.hash_sheets[this.uid] = structuredClone(this.rows);
        return true;
    }
}

const names = ['当前状态表', '角色状态表', '背包表', '当前任务与约定表', '人物主表', '人物发展表', '历史事件表'];
const sheets = names.map(name => new FakeSheet(name));
const piece = { hash_sheets: { old: 'sentinel' }, extra: { keep: 1 }, swipe_id: 0, swipe_info: [{ keep: 2 }] };
globalThis.__memoMocks = {
    BASE: { getChatSheets: () => sheets, copyHashSheets: structuredClone, hashSheetsToSheets() { sheets[0].rows[1][1] = 'partial-restore'; throw new Error('injected restore failure'); }, sheetsData: { context: [{ old: true }] } },
    USER: { getChatPiece: () => ({ piece }) },
    Cell: { CellAction: { editCell: 'edit', insertDownRow: 'insert', deleteSelfRow: 'delete' } },
};

const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const { parseMemoTableEdit, executeMemoTableEdit, restoreMemoSnapshot } = await import(moduleUrl);
const parserCases = [
    ['NO_CHANGE', true, true],
    ['updateRow(0,0,{0:0})', true, false],
    ['updateRow(0,9,{0:"x"})', false, false],
    ['insertRow(0,{9:"x"})', false, false],
    ['NO_CHANGE;deleteRow(0,0)', false, false],
    ['updateRow(0,0,{0:"x"});deleteRow(0,0)', false, false],
    ['evil(0)', false, false],
    ['insertRow(7,{0:"x"})', false, false],
];
for (const [input, ok, noChange] of parserCases) {
    const result = parseMemoTableEdit(input);
    if (result.ok !== ok || result.noChange !== noChange) throw new Error(`解析断言失败：${input} ${JSON.stringify(result)}`);
}

let result = executeMemoTableEdit('updateRow(0,0,{0:0})', piece);
if (!result.ok || sheets[0].rows[1][1] !== 0) throw new Error('数字0在严格执行链中丢失');
const beforeRows = structuredClone(sheets.map(sheet => sheet.rows));
const beforePiece = structuredClone(piece);
sheets[6].failSave = true;
result = executeMemoTableEdit('updateRow(0,0,{0:"changed"})', piece);
sheets[6].failSave = false;
if (result.ok) throw new Error('保存失败被误报成功');
if (JSON.stringify(sheets.map(sheet => sheet.rows)) !== JSON.stringify(beforeRows)) throw new Error('保存失败后Sheet未完整回滚');
if (JSON.stringify(piece) !== JSON.stringify(beforePiece)) throw new Error('保存失败后消息/Swipe快照未完整回滚');
const beforeRestoreRows = structuredClone(sheets.map(sheet => sheet.rows));
const restoreResult = restoreMemoSnapshot({ injected: true });
if (restoreResult.ok) throw new Error('中途失败的快照恢复被误报成功');
if (JSON.stringify(sheets.map(sheet => sheet.rows)) !== JSON.stringify(beforeRestoreRows)) throw new Error('中途失败的快照恢复未完整回滚');

console.log('runtime-safety-audit PASS: parser=8, numeric-zero=1, save-failure-full-rollback=1, restore-failure-full-rollback=1');

let structuredSource = await fs.readFile(new URL('../scripts/runtime/singleApiStructured.js', import.meta.url), 'utf8');
structuredSource = structuredSource
    .replace("import { APP, BASE, EDITOR, USER } from '../../core/manager.js';", 'const { APP, BASE, EDITOR, USER } = globalThis.__structuredMocks;')
    .replace("import { getTableEditTag } from '../../index.js';", 'const { getTableEditTag } = globalThis.__structuredMocks;')
    .replace("import { executeMemoTableEdit, restoreMemoSnapshot, saveMemoSnapshot } from './safeTableExecutor.js?v=memo85';", 'const { executeMemoTableEdit, restoreMemoSnapshot, saveMemoSnapshot } = globalThis.__structuredMocks;');
const handlers = new Map();
const baselineSheet = new FakeSheet('当前状态表');
const originalBaselineRows = structuredClone(baselineSheet.rows);
const previousMessage = { is_user: false, mes: 'previous', hash_sheets: { baseline: true } };
const structuredContext = { chat: [previousMessage], chatCompletionSettings: { stream_openai: false }, updateMessageBlock() {} };
let executeCount = 0;
globalThis.__structuredMocks = {
    APP: {
        event_types: { GENERATION_STARTED: 'start', CHAT_COMPLETION_PROMPT_READY: 'prompt', CHAT_COMPLETION_SETTINGS_READY: 'settings', CHARACTER_MESSAGE_RENDERED: 'rendered' },
        eventSource: { on: (event, handler) => handlers.set(event, handler), makeFirst() {}, makeLast() {} },
    },
    BASE: {
        getChatSheets: () => [baselineSheet],
        getLastSheetsPiece: () => ({ piece: previousMessage }),
        hashSheetsToSheets() { baselineSheet.rows[1][1] = 'partial-baseline'; throw new Error('injected baseline restore failure'); },
        initHashSheet: () => ({ hash_sheets: { empty: true } }),
        getReferencePiece() {},
    },
    EDITOR: { warning() {} },
    USER: {
        getSettings: () => ({ muyoo_dataTable: { independent_record_api_enabled: false } }),
        tableBaseSetting: { isExtensionAble: true, isAiReadTable: true, isAiWriteTable: true, injection_mode: 'on', step_by_step: false },
        getContext: () => structuredContext,
        saveChat: async () => true,
    },
    getTableEditTag: () => ({ matches: ['updateRow(0,0,{0:"new"})'] }),
    executeMemoTableEdit: () => { executeCount += 1; return { ok: true, changed: true, count: 1 }; },
    restoreMemoSnapshot(snapshot) {
        const before = structuredClone(baselineSheet.rows);
        try { this.BASE?.hashSheetsToSheets?.(snapshot); } catch (_) { baselineSheet.rows = before; }
        return { ok: false, error: 'injected baseline restore failure' };
    },
    saveMemoSnapshot() {},
};
await import(`data:text/javascript;base64,${Buffer.from(structuredSource).toString('base64')}#structured`);
handlers.get('start')('normal', {}, false);
await handlers.get('settings')({});
structuredContext.chat.push({ is_user: false, mes: JSON.stringify({ table_edit: 'updateRow(0,0,{0:"new"})', reply: 'visible' }), swipe_id: 0, swipes: [''] });
await handlers.get('rendered')(1);
if (executeCount !== 0) throw new Error('基线恢复失败后仍调用严格执行器');
if (JSON.stringify(baselineSheet.rows) !== JSON.stringify(originalBaselineRows)) throw new Error('基线恢复中途失败后未回滚Live Sheet');

const singleApiText = await fs.readFile(new URL('../scripts/runtime/singleApiStructured.js', import.meta.url), 'utf8');
const independentText = await fs.readFile(new URL('../scripts/runtime/separateTableUpdate.js', import.meta.url), 'utf8');
if (!singleApiText.includes('baselineReady?executeMemoTableEdit')) throw new Error('一次API缺少基线成功门控');
if (!singleApiText.includes('chat!==pending.sessionChat')) throw new Error('一次API缺少跨聊天pending隔离');
if (!independentText.includes('if(!prepareAutoBaseline')) throw new Error('自动独立记录缺少基线成功门控');
if (!independentText.includes('if(!baselineReady)throw new Error')) throw new Error('手动独立记录缺少基线成功门控');
if (!independentText.includes('!sessionChat.includes(initialPiece)')) throw new Error('手动独立记录缺少目标消息当前聊天归属校验');
const detachedGate = independentText.indexOf("return'detached'");
const independentExecute = independentText.indexOf('const result=executeMemoTableEdit');
if (detachedGate < 0 || independentExecute < 0 || detachedGate > independentExecute) throw new Error('独立记录缺少执行前聊天会话身份门控');
console.log('baseline-gate audit PASS: restore-failure-execute-count=0, partial-restore-rollback=1, independent-gates=2');
