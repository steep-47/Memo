import { APP, EDITOR, USER } from '../../core/manager.js';
import { getTableEditTag } from '../../index.js';

const PREF_KEY = 'independent_record_api_enabled';
const handled = new WeakSet();

function independentEnabled() {
    return USER?.getSettings?.()?.muyoo_dataTable?.[PREF_KEY] === true;
}

function stableStringify(value) {
    if (value == null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function previousAssistantWithSheets(chatList, fromIndex) {
    for (let i = fromIndex - 1; i >= 0; i--) {
        const item = chatList[i];
        if (!item || item.is_user === true) continue;
        if (item.hash_sheets && typeof item.hash_sheets === 'object') return item;
    }
    return null;
}

function finishSingleApi(chatId) {
    if (independentEnabled()) return;
    const chatList = USER?.getContext?.()?.chat;
    const chat = chatList?.[chatId];
    if (!chat || chat.is_user === true || handled.has(chat)) return;

    const { matches } = getTableEditTag(String(chat.mes ?? ''));
    const hasActualAction = matches?.some(text => /(?:insertRow|updateRow|deleteRow)\s*\(/.test(text));
    if (!hasActualAction) return;

    // 原作者 onMessageReceived 已在同一 CHARACTER_MESSAGE_RENDERED 事件中先执行并把最新表格状态保存到当前消息。
    // 只有当前消息的 hash_sheets 相比上一条带表格状态的助手消息真的发生变化，才显示成功。
    const previous = previousAssistantWithSheets(chatList, Number(chatId));
    const currentSheets = chat.hash_sheets;
    if (!currentSheets || stableStringify(currentSheets) === stableStringify(previous?.hash_sheets ?? {})) return;

    handled.add(chat);
    EDITOR.success('填表完成！');
}

const renderedEvent = APP.event_types.CHARACTER_MESSAGE_RENDERED;
APP.eventSource.on(renderedEvent, finishSingleApi);

console.log('[Memo] 一次API真实写入完成提示已加载');
