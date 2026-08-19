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

function hasRealSheetChange(chatList, chatId) {
    const chat = chatList?.[chatId];
    if (!chat?.hash_sheets) return false;
    const previous = previousAssistantWithSheets(chatList, Number(chatId));
    return stableStringify(chat.hash_sheets) !== stableStringify(previous?.hash_sheets ?? {});
}

function finishSingleApi(chatId) {
    if (independentEnabled()) return;
    const chatList = USER?.getContext?.()?.chat;
    const chat = chatList?.[chatId];
    if (!chat || chat.is_user === true || handled.has(chat)) return;

    const { matches } = getTableEditTag(String(chat.mes ?? ''));
    const hasActualAction = matches?.some(text => /(?:insertRow|updateRow|deleteRow)\s*\(/.test(text));
    if (!hasActualAction) return;

    const delays = [60, 180, 400];
    for (const delay of delays) {
        setTimeout(() => {
            if (handled.has(chat) || independentEnabled()) return;
            const latestList = USER?.getContext?.()?.chat;
            const latestChat = latestList?.[chatId];
            if (latestChat !== chat && !latestChat) return;
            if (!hasRealSheetChange(latestList, chatId)) return;

            handled.add(chat);
            EDITOR.success('填表完成！', '', 2500);
        }, delay);
    }
}

const renderedEvent = APP.event_types.CHARACTER_MESSAGE_RENDERED;
APP.eventSource.on(renderedEvent, finishSingleApi);

console.log('[Memo] 一次API真实写入绿色提示已加载');
