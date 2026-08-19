import { APP, USER } from '../../core/manager.js';
import { defaultSettings } from '../../data/pluginSetting.js';

const PREF_KEY = 'independent_record_api_enabled';
const PROTOCOL_START = '[一次API固定收尾协议]';
const PROTOCOL_END = '[/一次API固定收尾协议]';

const SINGLE_API_END_PROTOCOL = `
${PROTOCOL_START}
# 本轮回复硬性结束协议
- 正常生成剧情/回答正文后，必须继续检查六张表；正文结束不代表整轮回复完成。
- 最终回复必须以且仅以一个完整 <tableEdit>...</tableEdit> 区块结束；只有输出 </tableEdit> 才代表本轮真正完成。
- 有表格变化：在同一个 <tableEdit> 中输出本轮全部必要的 insertRow / updateRow / deleteRow。
- 尤其是新游戏、空表初始化或一次需要连续写入多条操作时，所有 insertRow / updateRow / deleteRow 都必须完整放在同一个 <tableEdit>...</tableEdit> 内，禁止任何函数调用裸露在正文中。
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

    // 本模块只拥有自己的收尾块。每次先移除旧块再追加，保证幂等；
    // 其余表格规则、schema、身份归一规则及用户已有模板内容全部原样保留。
    base = removeOwnProtocol(base);
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
        console.log('[Memo] 一次API：保留现有规则并追加固定tableEdit收尾协议');
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

console.log('[Memo] 一次API固定tableEdit收尾协议已加载（保留现有模板规则）');
