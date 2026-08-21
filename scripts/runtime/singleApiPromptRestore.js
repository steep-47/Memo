import { APP, USER } from '../../core/manager.js';
import { defaultSettings } from '../../data/pluginSetting.js';

const PREF_KEY = 'independent_record_api_enabled';
const PROTOCOL_START = '[一次API固定收尾协议]';
const PROTOCOL_END = '[/一次API固定收尾协议]';
const OUTPUT_RULE = '- 一次API模式必须同时生成正常完整回复和机器表格记录；具体传输格式只服从API请求末尾最后出现的协议，不得沿用或混合其他JSON/tableEdit格式。';

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
    let value = String(text || '').split('\n').filter(line => {
        const trimmed = line.trim();
        if (trimmed.includes('一次API模式使用结构化双字段响应')) return false;
        if (trimmed.startsWith('- 正文后仅在确有表格操作时输出<tableEdit>')) return false;
        if (trimmed.startsWith('- 正文后必须以一个完整<tableEdit>结束')) return false;
        if (trimmed.startsWith('- 剧情/回答主体写完后，先立即输出一个完整<tableEdit>')) return false;
        if (trimmed.startsWith('- 最终回复必须先输出恰好一个完整<tableEdit>机器记录')) return false;
        return trimmed !== OUTPUT_RULE;
    }).join('\n');
    if (!value.includes(OUTPUT_RULE)) {
        const outputHeading = '# 输出';
        if (value.includes(outputHeading)) value = value.replace(outputHeading, `${outputHeading}\n${OUTPUT_RULE}`);
        else value = `${value.trim()}\n${OUTPUT_RULE}`.trim();
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
    return base.trim();
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
        console.log('[Memo] 一次API：已删除旧输出协议并恢复唯一传输规则');
    }
}

// 同步代码默认对象，避免新会话/设置重建再次拿到memo73的tableEdit-first规则。
try {
    defaultSettings.message_template = buildSingleApiTemplate(defaultSettings.message_template);
} catch (error) {
    console.warn('[Memo] 默认一次API结构化协议归一失败', error);
}

restoreSingleApiPrompt();
queueMicrotask(restoreSingleApiPrompt);
setTimeout(restoreSingleApiPrompt, 250);
const promptEvent = APP.event_types.CHAT_COMPLETION_PROMPT_READY;
APP.eventSource.on(promptEvent, restoreSingleApiPrompt);
if (typeof APP.eventSource.makeFirst === 'function') APP.eventSource.makeFirst(promptEvent, restoreSingleApiPrompt);

console.log('[Memo] 一次API提示清理器已加载：旧协议只删除，不再叠加');
