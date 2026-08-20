import { APP, USER } from '../../core/manager.js';
import { defaultSettings } from '../../data/pluginSetting.js';

const PREF_KEY = 'independent_record_api_enabled';
const PROTOCOL_START = '[一次API固定收尾协议]';
const PROTOCOL_END = '[/一次API固定收尾协议]';
const LEGACY_OUTPUT_RULE = '- 正文后仅在确有表格操作时输出<tableEdit><!-- 函数调用 --></tableEdit>。所有必要表格操作放在同一个<tableEdit>中。';
const UNIFIED_OUTPUT_RULE = '- 正文后必须以一个完整<tableEdit>结束：有表格变化时写入所有必要的insertRow/updateRow/deleteRow；没有任何需要记录的变化时输出<tableEdit><!-- NO_CHANGE --></tableEdit>。';

const SINGLE_API_END_PROTOCOL = `
${PROTOCOL_START}
# 本轮回复硬性结束协议
- 正常生成剧情/回答正文后，必须继续检查六张表；正文结束不代表整轮回复完成。
- 最终回复必须以且仅以一个完整 <tableEdit>...</tableEdit> 区块结束；只有输出 </tableEdit> 才代表本轮真正完成。
- 有表格变化：所有 insertRow / updateRow / deleteRow 必须放在同一个 HTML 注释中，并整体包在 <tableEdit> 内，固定格式为 <tableEdit><!-- 操作代码 --></tableEdit>；禁止把函数调用裸露在正文中。
- 没有任何需要记录的变化：仍必须输出 <tableEdit><!-- NO_CHANGE --></tableEdit>。
- tableEdit 必须真实出现在最终回复文本中，不能只在思考/推理中处理，不能用自然语言替代。
- 表格已有同一对象或状态行时继续遵守原表规则优先 update/覆盖；不得因为本协议而重复 insert。
${PROTOCOL_END}`;

function independentEnabled() {
    return USER?.getSettings?.()?.muyoo_dataTable?.[PREF_KEY] === true;
}

function removeOwnProtocol(text) {
    const value = String(text || '');
    const start = value.indexOf(PROTOCOL_START);
    if (start < 0) return value;
    const end = value.indexOf(PROTOCOL_END, start);
    if (end < 0) return value.slice(0, start).trimEnd();
    return `${value.slice(0, start)}${value.slice(end + PROTOCOL_END.length)}`.trimEnd();
}

function normalizeOutputRule(text) {
    const value = String(text || '');
    if (value.includes(LEGACY_OUTPUT_RULE)) {
        return value.replace(LEGACY_OUTPUT_RULE, UNIFIED_OUTPUT_RULE);
    }
    return value;
}

function isMemo38Replacement(text) {
    const value = String(text || '');
    return value.includes('# Memo 本轮任务')
        && value.includes('# 硬性结束协议')
        && value.includes('# 世界状态记忆表');
}

function buildSingleApiTemplate(currentTemplate) {
    let base = String(currentTemplate || '').trim();

    // memo.38 曾把完整 message_template 整段替换掉。
    // 若检测到该模板，恢复当前代码中的基础模板；defaultSettings 已由 memoryContentRules
    // 同步补入角色/NPC归一等规则，避免把已有“螺丝钉”继续丢失。
    if (!base || isMemo38Replacement(base)) {
        base = String(defaultSettings?.message_template || '').trim();
    }

    // 先消除旧模板中“仅有变化才输出tableEdit”的冲突规则，
    // 再追加唯一的固定收尾协议。这样每轮只有一个结论：有变化写操作，无变化写NO_CHANGE。
    base = normalizeOutputRule(removeOwnProtocol(base));
    return `${base}\n\n${SINGLE_API_END_PROTOCOL.trim()}`.trim();
}

function restoreSingleApiPrompt() {
    if (independentEnabled()) return;
    const settings = USER?.getSettings?.();
    if (!settings) return;
    if (!settings.muyoo_dataTable || typeof settings.muyoo_dataTable !== 'object') {
        settings.muyoo_dataTable = {};
    }

    const current = settings.muyoo_dataTable.message_template;
    const next = buildSingleApiTemplate(current);
    if (current !== next) {
        settings.muyoo_dataTable.message_template = next;
        USER.saveSettings?.();
        console.log('[Memo] 一次API：已统一tableEdit收尾规则并保留现有模板');
    }
}

restoreSingleApiPrompt();
queueMicrotask(restoreSingleApiPrompt);
setTimeout(restoreSingleApiPrompt, 250);

const promptEvent = APP.event_types.CHAT_COMPLETION_PROMPT_READY;
APP.eventSource.on(promptEvent, restoreSingleApiPrompt);
if (typeof APP.eventSource.makeFirst === 'function') {
    APP.eventSource.makeFirst(promptEvent, restoreSingleApiPrompt);
}

console.log('[Memo] 一次API固定tableEdit收尾协议已加载（冲突规则已统一）');
