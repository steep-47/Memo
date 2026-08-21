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
    ['INSERTINTO1VALUES({0:"x"})', false, false],
    ['INSERT INTO 1 VALUES ({0:"x"})', false, false],
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

console.log('runtime-safety-audit PASS: parser=10, numeric-zero=1, save-failure-full-rollback=1, restore-failure-full-rollback=1');

const channels = await import('../scripts/runtime/memoResponseChannels.js');
const reasoningOnly = { mes: '正常正文', extra: { reasoning: '<tableEdit><!-- updateRow(0,0,{1:"08:40"}) --></tableEdit>' } };
const recovered = channels.getMemoTableEditChannel(reasoningOnly);
if (recovered.source !== 'reasoning' || recovered.matches.length !== 1) throw new Error('未从隐藏推理区恢复tableEdit');
const contentWins = channels.getMemoTableEditChannel({ mes: '<tableEdit><!-- NO_CHANGE --></tableEdit>', extra: reasoningOnly.extra });
if (contentWins.source !== 'content' || contentWins.matches.length !== 1 || !contentWins.matches[0].includes('NO_CHANGE')) throw new Error('正文/推理同时存在时未保证正文优先和单次执行');
const swipeWins = channels.getMemoTableEditChannel({ mes: '正文', swipe_id: 1, extra: reasoningOnly.extra, swipe_info: [{}, { extra: { reasoning: '<tableEdit><!-- insertRow(2,{0:"黄芪"}) --></tableEdit>' } }] });
if (swipeWins.source !== 'reasoning' || !swipeWins.matches[0].includes('insertRow')) throw new Error('未读取当前Swipe独立推理区');
const bareReasoning = channels.getMemoTableEditChannel({ mes: '正文', extra: { reasoning: '考虑调用 updateRow(0,0,{1:"09:00"})' } });
if (bareReasoning.source !== 'none' || bareReasoning.matches.length) throw new Error('错误接受了推理区裸函数猜测');
const tolerantTag = channels.getMemoTableEditChannel({ mes: '正文', extra: { reasoning: '<TABLEEDIT data-hidden="1"><!-- NO_CHANGE --></TABLEEDIT>' } });
if (tolerantTag.source !== 'reasoning' || tolerantTag.matches.length !== 1) throw new Error('未兼容推理区标签大小写/属性');
console.log('response-channel audit PASS: reasoning-recovery=1, content-priority=1, swipe-reasoning=1, bare-text-rejected=1, tolerant-tag=1');

const independentText = await fs.readFile(new URL('../scripts/runtime/separateTableUpdate.js', import.meta.url), 'utf8');
const finishText = await fs.readFile(new URL('../scripts/runtime/singleApiFinish.js', import.meta.url), 'utf8');
const loaderText = await fs.readFile(new URL('../loader.js', import.meta.url), 'utf8');
const indexText = await fs.readFile(new URL('../index.js', import.meta.url), 'utf8');
const settingsText = await fs.readFile(new URL('../data/pluginSetting.js', import.meta.url), 'utf8');
const bootstrapText = await fs.readFile(new URL('../scripts/runtime/settingsBootstrap.js', import.meta.url), 'utf8');
if (loaderText.includes('singleApiStructured') || loaderText.includes('singleApiPromptRestore')) throw new Error('loader仍加载冲突的结构化/提示改写层');
if (!indexText.includes('CHAT_COMPLETION_PROMPT_READY, onChatCompletionPromptReady') || !indexText.includes('CHARACTER_MESSAGE_RENDERED, onMessageReceived')) throw new Error('原作者直接注入/直接解析事件链缺失');
if (!indexText.includes('executeMemoTableEdit(matches, piece)')) throw new Error('直接解析入口未接严格事务执行器');
if (!settingsText.includes('正常生成给用户看的完整回复') || !settingsText.includes('<tableEdit><!-- ... --></tableEdit>')) throw new Error('主模板未恢复同回复tableEdit协议');
if (!settingsText.includes('机器块不是SQL') || !settingsText.includes('INSERT、INTO、VALUES、UPDATE、DELETE、SQL')) throw new Error('主模板缺少非SQL约束');
if (!settingsText.includes('日影移动') || !settingsText.includes('每轮都必须输出tableEdit')) throw new Error('主模板缺少时间推进/每轮检查规则');
if (!bootstrapText.includes('migrateKnownSingleApiOutput') || !bootstrapText.includes('一次API模式使用结构化双字段响应')) throw new Error('缺少手机已保存旧模板的一次性升级迁移');
if (!independentText.includes('if(!prepareAutoBaseline')) throw new Error('自动独立记录缺少基线成功门控');
if (!independentText.includes('if(!baselineReady)throw new Error')) throw new Error('手动独立记录缺少基线成功门控');
if (!independentText.includes('!sessionChat.includes(initialPiece)')) throw new Error('手动独立记录缺少目标消息当前聊天归属校验');
if (!finishText.includes("if(status.noChange===true){EDITOR.info('本轮无需填表'")) throw new Error('一次API缺少NO_CHANGE明确状态提示');
const detachedGate = independentText.indexOf("return'detached'");
const independentExecute = independentText.indexOf('const result=executeMemoTableEdit');
if (detachedGate < 0 || independentExecute < 0 || detachedGate > independentExecute) throw new Error('独立记录缺少执行前聊天会话身份门控');
console.log('direct-path audit PASS: original-injection=1, rendered-parser=1, strict-executor=1, conflicting-layers=0, roleplay-time-required=1, independent-gates=2, no-change-toast=1');
