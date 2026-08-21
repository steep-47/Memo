import { APP, USER } from '../../core/manager.js';
import { defaultSettings } from '../../data/pluginSetting.js';

const PREF_KEY = 'independent_record_api_enabled';
const PROTOCOL_START = '[一次API固定收尾协议]';
const PROTOCOL_END = '[/一次API固定收尾协议]';
const LEGACY_OUTPUT_RULE = '- 正文后仅在确有表格操作时输出<tableEdit><!-- 函数调用 --></tableEdit>。所有必要表格操作放在同一个<tableEdit>中。';
const OLD_UNIFIED_OUTPUT_RULE = '- 正文后必须以一个完整<tableEdit>结束：有表格变化时写入所有必要的insertRow/updateRow/deleteRow；没有任何需要记录的变化时输出<tableEdit><!-- NO_CHANGE --></tableEdit>。';
const UNIFIED_OUTPUT_RULE = '- 剧情/回答主体写完后，先立即输出一个完整<tableEdit>：有表格变化时写入所有必要的insertRow/updateRow/deleteRow；没有任何需要记录的变化时输出<tableEdit><!-- NO_CHANGE --></tableEdit>。随后再写参考行动、选项、伊依留言等回复尾部内容。';

const SINGLE_API_END_PROTOCOL = `
${PROTOCOL_START}
# 本轮回复硬性表格协议
- 正常生成剧情/回答主体；主体事实写完后，必须立刻检查七张表并输出 tableEdit，不要等到整条回复最后。
- 固定顺序：剧情/回答主体 → <tableEdit>...</tableEdit> → 参考行动/选项 → 伊依留言或其他尾部内容 → 正常结束。
- tableEdit 是主体与回复尾部之间的机器记录阶段；不得把它拖到选项、伊依留言之后。
- 有表格变化：所有 insertRow / updateRow / deleteRow 必须放在同一个 HTML 注释中，并整体包在 <tableEdit> 内，固定格式为 <tableEdit><!-- 操作代码 --></tableEdit>；禁止把函数调用裸露在正文中。
- 没有任何需要记录的变化：仍必须在主体结束后立即输出 <tableEdit><!-- NO_CHANGE --></tableEdit>，然后才继续写选项或留言。
- tableEdit 必须真实出现在最终回复文本中，不能只在思考/推理中处理，不能用自然语言替代。
- 表4人物主表与表5人物发展表必须按同一NPC对应维护；已有对象优先 update，禁止重复 insert。
- 若本轮没有参考行动、选项、伊依留言等尾部内容，则 tableEdit 可以自然成为最后内容；不要为了满足格式额外编造尾部文字。
${PROTOCOL_END}`;

function independentEnabled() { return USER?.getSettings?.()?.muyoo_dataTable?.[PREF_KEY] === true; }
function removeOwnProtocol(text) {
    const value = String(text || '');
    const start = value.indexOf(PROTOCOL_START);
    if (start < 0) return value;
    const end = value.indexOf(PROTOCOL_END, start);
    if (end < 0) return value.slice(0, start).trimEnd();
    return `${value.slice(0, start)}${value.slice(end + PROTOCOL_END.length)}`.trimEnd();
}
function normalizeOutputRule(text) {
    let value = String(text || '');
    if (value.includes(LEGACY_OUTPUT_RULE)) value = value.replace(LEGACY_OUTPUT_RULE, UNIFIED_OUTPUT_RULE);
    if (value.includes(OLD_UNIFIED_OUTPUT_RULE)) value = value.replace(OLD_UNIFIED_OUTPUT_RULE, UNIFIED_OUTPUT_RULE);
    return value;
}
function isMemo38Replacement(text) {
    const value = String(text || '');
    return value.includes('# Memo 本轮任务') && value.includes('# 硬性结束协议') && value.includes('# 世界状态记忆表');
}
function buildSingleApiTemplate(currentTemplate) {
    let base = String(currentTemplate || '').trim();
    if (!base || isMemo38Replacement(base)) base = String(defaultSettings?.message_template || '').trim();
    base = normalizeOutputRule(removeOwnProtocol(base));
    return `${base}\n\n${SINGLE_API_END_PROTOCOL.trim()}`.trim();
}
function restoreSingleApiPrompt() {
    if (independentEnabled()) return;
    const settings = USER?.getSettings?.();
    if (!settings) return;
    if (!settings.muyoo_dataTable || typeof settings.muyoo_dataTable !== 'object') settings.muyoo_dataTable = {};
    const current = settings.muyoo_dataTable.message_template;
    const next = buildSingleApiTemplate(current);
    if (current !== next) {
        settings.muyoo_dataTable.message_template = next;
        USER.saveSettings?.();
        console.log('[Memo] 一次API：七表tableEdit中段协议已统一');
    }
}
restoreSingleApiPrompt();
queueMicrotask(restoreSingleApiPrompt);
setTimeout(restoreSingleApiPrompt, 250);
const promptEvent = APP.event_types.CHAT_COMPLETION_PROMPT_READY;
APP.eventSource.on(promptEvent, restoreSingleApiPrompt);
if (typeof APP.eventSource.makeFirst === 'function') APP.eventSource.makeFirst(promptEvent, restoreSingleApiPrompt);
console.log('[Memo] 一次API 七表tableEdit中段记录协议已加载');
