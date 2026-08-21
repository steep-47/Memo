import { APP, EDITOR, USER } from '../../core/manager.js';
import { TableTwoStepSummary } from './separateTableUpdate.js?v=memo77';

const PREF_KEY = 'independent_record_api_enabled';
const attempted = new WeakMap();
const queuedChatIds = new Set();
let independentRunActive = false;

function readEnabled() {
    return USER?.getSettings?.()?.muyoo_dataTable?.[PREF_KEY] === true;
}

function forceNormalMode() {
    if (!USER?.tableBaseSetting) return;
    USER.tableBaseSetting.step_by_step = false;
}

function preparePromptMode() {
    if (!USER?.tableBaseSetting) return;
    USER.tableBaseSetting.step_by_step = readEnabled();
}

function beforeRendered() {
    forceNormalMode();
}

function visibleMes(chat) {
    return String(chat?.mes ?? '').replace(/<tableEdit>[\s\S]*?<\/tableEdit>/gi, '').trim();
}
function tokenFor(chat) {
    return `${Number(chat?.swipe_id ?? 0)}\u241f${visibleMes(chat)}`;
}

function hasAttempted(chat, token) {
    return attempted.get(chat)?.has(token) === true;
}

function markAttempted(chat, token) {
    let set = attempted.get(chat);
    if (!set) {
        set = new Set();
        attempted.set(chat, set);
    }
    set.add(token);
}

function drainQueue() {
    if (independentRunActive || !queuedChatIds.size) return;
    const [chatId] = queuedChatIds;
    queuedChatIds.delete(chatId);
    queueMicrotask(() => triggerIndependentRecord(chatId));
}

function triggerIndependentRecord(chatId) {
    if (!readEnabled() || !USER?.tableBaseSetting) return;
    const chat = USER?.getContext?.()?.chat?.[chatId];
    if (!chat || chat.is_user === true) return;
    const token = tokenFor(chat);
    if (hasAttempted(chat, token)) return;

    if (independentRunActive) {
        queuedChatIds.add(chatId);
        return;
    }

    markAttempted(chat, token);
    independentRunActive = true;
    let task;
    try {
        USER.tableBaseSetting.step_by_step = true;
        task = TableTwoStepSummary('auto');
    } catch (error) {
        independentRunActive = false;
        forceNormalMode();
        console.error('[Memo] 独立记录 API 启动失败:', error);
        EDITOR.warning(`独立记录未启动：${error?.message || error}`);
        drainQueue();
        return;
    } finally {
        forceNormalMode();
    }

    Promise.resolve(task)
        .then(result => {
            if (result === true) {
                EDITOR.success('独立填表完成！');
                console.log(`[Memo] 独立记录 API：swipe=${Number(chat?.swipe_id ?? 0)} 本轮记录完成`);
            } else {
                console.warn('[Memo] 独立记录 API：本轮未完成写入；为避免重复扣费，本swipe不会自动重试');
                EDITOR.warning('独立记录未完成：本轮未成功写入。不会自动重试；可手动立即填表或重新生成。');
            }
        })
        .catch(error => {
            console.error('[Memo] 独立记录 API 执行异常:', error);
            EDITOR.warning(`独立记录执行异常：${error?.message || error}。不会自动重试。`);
        })
        .finally(() => {
            independentRunActive = false;
            forceNormalMode();
            drainQueue();
        });
}

const promptEvent = APP.event_types.CHAT_COMPLETION_PROMPT_READY;
const renderedEvent = APP.event_types.CHARACTER_MESSAGE_RENDERED;
APP.eventSource.on(promptEvent, preparePromptMode);
APP.eventSource.on(renderedEvent, beforeRendered);
APP.eventSource.on(renderedEvent, triggerIndependentRecord);

if (typeof APP.eventSource.makeFirst === 'function') {
    APP.eventSource.makeFirst(promptEvent, preparePromptMode);
    APP.eventSource.makeFirst(renderedEvent, beforeRendered);
}
if (typeof APP.eventSource.makeLast === 'function') APP.eventSource.makeLast(renderedEvent, triggerIndependentRecord);

forceNormalMode();
console.log('[Memo] 独立记录 API：按message+swipe可见正文去重；失败不自动重试；隐藏记录不触发重复API');
