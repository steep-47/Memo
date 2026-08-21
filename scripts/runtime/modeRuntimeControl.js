import { APP, EDITOR, USER } from '../../core/manager.js';
import { TableTwoStepSummary } from './separateTableUpdate.js';

const PREF_KEY = 'independent_record_api_enabled';
const handled = new WeakSet();
let independentRunActive = false;

function readEnabled() {
    const settings = USER?.getSettings?.();
    return settings?.muyoo_dataTable?.[PREF_KEY] === true;
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

function triggerIndependentRecord(chatId) {
    if (!readEnabled() || independentRunActive || !USER?.tableBaseSetting) return;

    const chat = USER?.getContext?.()?.chat?.[chatId];
    if (!chat || chat.is_user === true || handled.has(chat)) return;

    handled.add(chat);
    independentRunActive = true;

    let task;
    try {
        USER.tableBaseSetting.step_by_step = true;
        task = TableTwoStepSummary('auto');
    } catch (error) {
        handled.delete(chat);
        independentRunActive = false;
        console.error('[Memo] 独立记录 API 启动失败:', error);
        EDITOR.warning(`独立记录未启动：${error?.message || error}`);
        return;
    } finally {
        forceNormalMode();
    }

    Promise.resolve(task)
        .then((result) => {
            if (result === true) {
                EDITOR.success('独立填表完成！');
                console.log('[Memo] 独立记录 API：本轮记录完成');
            } else {
                handled.delete(chat);
                console.warn('[Memo] 独立记录 API：本轮未完成写入');
                EDITOR.warning('独立记录未完成：本轮没有成功写入表格。请查看控制台中的 [World Memory] 具体原因。');
            }
        })
        .catch((error) => {
            handled.delete(chat);
            console.error('[Memo] 独立记录 API 执行异常:', error);
            EDITOR.warning(`独立记录执行异常：${error?.message || error}`);
        })
        .finally(() => {
            independentRunActive = false;
            forceNormalMode();
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
if (typeof APP.eventSource.makeLast === 'function') {
    APP.eventSource.makeLast(renderedEvent, triggerIndependentRecord);
}

forceNormalMode();
console.log('[Memo] 独立记录 API：正文后额外记录，失败不再静默');
