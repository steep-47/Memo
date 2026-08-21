import { APP, USER } from '../../core/manager.js';
import { defaultSettings } from '../../data/pluginSetting.js';

const PREF_KEY = 'independent_record_api_enabled';
const PROTOCOL_START = '[一次API固定收尾协议]';
const PROTOCOL_END = '[/一次API固定收尾协议]';
const LEGACY_OUTPUT_RULE = '- 正文后仅在确有表格操作时输出<tableEdit><!-- 函数调用 --></tableEdit>。所有必要表格操作放在同一个<tableEdit>中。';
const OLD_UNIFIED_OUTPUT_RULE = '- 正文后必须以一个完整<tableEdit>结束：有表格变化时写入所有必要的insertRow/updateRow/deleteRow；没有任何需要记录的变化时输出<tableEdit><!-- NO_CHANGE --></tableEdit>。';
const OLD_MIDDLE_OUTPUT_RULE = '- 剧情/回答主体写完后，先立即输出一个完整<tableEdit>：有表格变化时写入所有必要的insertRow/updateRow/deleteRow；没有任何需要记录的变化时输出<tableEdit><!-- NO_CHANGE --></tableEdit>。随后再写参考行动、选项、伊依留言等回复尾部内容。';
const TABLE_FIRST_OUTPUT_RULE = '- 最终回复必须先输出恰好一个完整<tableEdit>机器记录，再开始剧情/回答正文；有表格变化时写入所有必要的insertRow/updateRow/deleteRow，没有任何需要记录的变化时输出<tableEdit><!-- NO_CHANGE --></tableEdit>。tableEdit之后再正常写正文、参考行动、选项和留言。';

const SINGLE_API_END_PROTOCOL = `
${PROTOCOL_START}
# 本轮回复硬性表格协议（tableEdit-first）
- 在输出任何剧情、回答、标题、状态栏、选项、留言、<details>、<summary>之前，第一段必须先输出恰好一个完整 <tableEdit>...</tableEdit>。
- 固定顺序：<tableEdit>...</tableEdit> → 剧情/回答主体 → 参考行动/选项 → 伊依留言或其他尾部内容 → 正常结束。
- tableEdit 是本轮机器记录阶段，必须在长正文开始前完成；禁止把它推迟到正文中段或结尾。
- 有表格变化：所有 insertRow / updateRow / deleteRow 必须放在同一个 HTML 注释中，并整体包在 <tableEdit> 内，固定格式为 <tableEdit><!-- 操作代码 --></tableEdit>。
- 没有任何需要记录的变化：第一段仍必须输出 <tableEdit><!-- NO_CHANGE --></tableEdit>。
- tableEdit 必须真实出现在最终回复文本中，不能只在思考/推理中处理，不能用自然语言替代。
- 输出 tableEdit 后，再按角色设定正常完成正文；机器记录块不应改变正文风格或剧情内容。
- 表4人物主表与表5人物发展表必须按同一NPC对应维护；已有对象优先 update，禁止重复 insert。
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
    for (const oldRule of [LEGACY_OUTPUT_RULE, OLD_UNIFIED_OUTPUT_RULE, OLD_MIDDLE_OUTPUT_RULE]) {
        if (value.includes(oldRule)) value = value.replace(oldRule, TABLE_FIRST_OUTPUT_RULE);
    }
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
        console.log('[Memo] 一次API：七表tableEdit-first协议已统一');
    }
}
restoreSingleApiPrompt();
queueMicrotask(restoreSingleApiPrompt);
setTimeout(restoreSingleApiPrompt, 250);
const promptEvent = APP.event_types.CHAT_COMPLETION_PROMPT_READY;
APP.eventSource.on(promptEvent, restoreSingleApiPrompt);
if (typeof APP.eventSource.makeFirst === 'function') APP.eventSource.makeFirst(promptEvent, restoreSingleApiPrompt);
console.log('[Memo] 一次API 七表tableEdit-first记录协议已加载');
