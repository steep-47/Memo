import { APP, EDITOR, USER } from '../../core/manager.js';
import { getTableEditTag } from '../../index.js';

const PREF_KEY = 'independent_record_api_enabled';
const handled = new WeakSet();

function independentEnabled() {
    return USER?.getSettings?.()?.muyoo_dataTable?.[PREF_KEY] === true;
}

function finishSingleApi(chatId) {
    if (independentEnabled()) return;
    const chat = USER?.getContext?.()?.chat?.[chatId];
    if (!chat || chat.is_user === true || handled.has(chat)) return;

    const { matches } = getTableEditTag(String(chat.mes ?? ''));
    if (!matches?.length) return;

    // 原作者 onMessageReceived 在同一个 CHARACTER_MESSAGE_RENDERED 事件中先执行写表；
    // 本监听器只做完成态 UI，不再次执行任何表格操作，避免重复记录。
    handled.add(chat);
    EDITOR.success('填表完成！');
}

const renderedEvent = APP.event_types.CHARACTER_MESSAGE_RENDERED;
APP.eventSource.on(renderedEvent, finishSingleApi);

console.log('[Memo] 一次API完成提示已加载');
