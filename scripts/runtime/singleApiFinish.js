import { APP, EDITOR, USER } from '../../core/manager.js';
import { getTableEditTag } from '../../index.js';

const PREF_KEY = 'independent_record_api_enabled';
const handled = new WeakMap();

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

function hasRealSheetChange(chatList, chatId) {
    const chat = chatList?.[chatId];
    if (!chat?.hash_sheets) return false;
    const previous = previousAssistantWithSheets(chatList, Number(chatId));
    return stableStringify(chat.hash_sheets) !== stableStringify(previous?.hash_sheets ?? {});
}

function tokenFor(chat, latestBlock) {
    return `${Number(chat?.swipe_id ?? 0)}\u241f${String(latestBlock ?? '')}\u241f${String(chat?.mes ?? '')}`;
}

function wasHandled(chat, token) {
    return handled.get(chat)?.has(token) === true;
}

function markHandled(chat, token) {
    let set = handled.get(chat);
    if (!set) {
        set = new Set();
        handled.set(chat, set);
    }
    set.add(token);
}

function finishSingleApi(chatId) {
    if (independentEnabled()) return;
    const chatList = USER?.getContext?.()?.chat;
    const chat = chatList?.[chatId];
    if (!chat || chat.is_user === true) return;

    const { matches } = getTableEditTag(String(chat.mes ?? ''));
    const latestBlock = Array.isArray(matches) && matches.length ? matches[matches.length - 1] : '';
    const hasActualAction = /(?:insertRow|updateRow|deleteRow)\s*\(/.test(String(latestBlock));
    if (!hasActualAction) return;
    const token = tokenFor(chat, latestBlock);
    if (wasHandled(chat, token)) return;

    for (const delay of [60,180,400]) {
        setTimeout(() => {
            if (wasHandled(chat, token) || independentEnabled()) return;
            const latestList = USER?.getContext?.()?.chat;
            const latestChat = latestList?.[chatId];
            if (!latestChat || latestChat !== chat) return;
            const latestMatches = getTableEditTag(String(latestChat.mes ?? '')).matches || [];
            const latestNow = latestMatches.length ? latestMatches[latestMatches.length - 1] : '';
            if (tokenFor(latestChat, latestNow) !== token) return;
            if (!hasRealSheetChange(latestList, chatId)) return;
            markHandled(chat, token);
            EDITOR.success('填表完成！', '', 2500);
        }, delay);
    }
}

APP.eventSource.on(APP.event_types.CHARACTER_MESSAGE_RENDERED, finishSingleApi);
console.log('[Memo] 一次API真实写入绿色提示已加载：按message+swipe+本轮最后tableEdit去重');
