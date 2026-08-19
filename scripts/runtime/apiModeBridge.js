import { APP, BASE, USER } from '../../core/manager.js';
import { replaceUserTag } from '../../utils/stringUtil.js';

const PREF_KEY = 'independent_record_api_enabled';
const PREV_INJECTION_KEY = 'memo_previous_injection_mode';

function getStore() {
    const root = USER?.getSettings?.();
    if (!root) return null;
    if (!root.muyoo_dataTable || typeof root.muyoo_dataTable !== 'object') root.muyoo_dataTable = {};
    return root.muyoo_dataTable;
}

export function isIndependentRecordEnabled() {
    return getStore()?.[PREF_KEY] === true;
}

function buildWritableTablePrompt() {
    try {
        const piece = BASE.getReferencePiece?.();
        if (!piece?.hash_sheets) return '';
        const sheets = BASE.hashSheetsToSheets(piece.hash_sheets)
            .filter(sheet => sheet.enable)
            .filter(sheet => sheet.sendToContext !== false);
        const tableData = sheets
            .map((sheet, index) => sheet.getTableText(index, ['title', 'node', 'headers', 'rows', 'editRules'], piece))
            .join('\n');
        if (!tableData) return '';
        const template = String(USER.tableBaseSetting.message_template || '');
        return replaceUserTag(template.replace('{{tableData}}', tableData));
    } catch (error) {
        console.error('[Memo] 构建单API内联填表提示失败：', error);
        return '';
    }
}

function appendPromptToLastUserMessage(eventData, prompt) {
    if (!prompt || !Array.isArray(eventData?.chat)) return false;
    let target = null;
    for (let i = eventData.chat.length - 1; i >= 0; i--) {
        if (eventData.chat[i]?.role === 'user') {
            target = eventData.chat[i];
            break;
        }
    }
    if (!target) return false;

    const suffix = `\n\n<MemoInternal>\n${prompt}\n</MemoInternal>`;
    if (typeof target.content === 'string') {
        // 只修改本次 API 请求的 messages 副本，不修改 SillyTavern 聊天正文。
        target.content += suffix;
        return true;
    }
    if (Array.isArray(target.content)) {
        target.content.push({ type: 'text', text: suffix });
        return true;
    }
    return false;
}

function syncRuntimeMode() {
    const enabled = isIndependentRecordEnabled();
    const store = getStore();
    if (!USER?.tableBaseSetting || !store) return enabled;

    USER.tableBaseSetting.step_by_step = enabled;

    if (enabled) {
        // 开启独立API时恢复原作者的注入方式，让正文只读表、回复后再单独填表。
        if (USER.tableBaseSetting.injection_mode === 'injection_off') {
            USER.tableBaseSetting.injection_mode = store[PREV_INJECTION_KEY] || 'deep_system';
        }
    } else {
        // 关闭独立API时由本桥接把完整可写提示直接附在真实 user 消息里。
        // 同时暂时关闭原作者额外 system 注入，避免同一提示重复发送。
        if (USER.tableBaseSetting.injection_mode !== 'injection_off') {
            store[PREV_INJECTION_KEY] = USER.tableBaseSetting.injection_mode || 'deep_system';
        }
        USER.tableBaseSetting.injection_mode = 'injection_off';
    }
    return enabled;
}

// 必须先于 index.js 的监听器注册（loader.js 已保证本文件先加载）。
APP.eventSource.on(APP.event_types.CHAT_COMPLETION_PROMPT_READY, (eventData) => {
    const enabled = syncRuntimeMode();
    if (enabled) return;
    if (eventData?.dryRun === true || USER.tableBaseSetting.isExtensionAble === false || USER.tableBaseSetting.isAiReadTable === false) return;

    const prompt = buildWritableTablePrompt();
    const appended = appendPromptToLastUserMessage(eventData, prompt);
    console.log(`[Memo] 单API内联填表提示：${appended ? '已附加到真实user消息' : '附加失败'}`);
});

// 回复落地前再次按开关同步，确保关闭时只解析本次回复中的 <tableEdit>，不会进入独立填表。
APP.eventSource.on(APP.event_types.CHARACTER_MESSAGE_RENDERED, () => {
    syncRuntimeMode();
});

APP.eventSource.on(APP.event_types.MESSAGE_EDITED, () => {
    syncRuntimeMode();
});

syncRuntimeMode();
console.log('[Memo] API模式桥接已加载：关闭=真实user消息内联提示的一次API；开启=独立填表');
