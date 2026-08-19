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

/**
 * 独立记录 API 开启时，仅在“构建正文提示”这个阶段临时借用原作者的
 * step_by_step 只读注入分支。这样正文只读取表格，不会要求正文输出 tableEdit。
 * 注意：这里不负责触发第二次 API。
 */
function preparePromptMode() {
    if (!USER?.tableBaseSetting) return;
    USER.tableBaseSetting.step_by_step = readEnabled();
}

/**
 * 正文已经生成并准备落地时，必须先恢复普通模式。
 * 该监听器被放到 CHARACTER_MESSAGE_RENDERED 最前面，因此原作者的
 * onMessageReceived 不会误认为当前仍处于 step_by_step，从而不会抢先重生成。
 */
function beforeRendered() {
    forceNormalMode();
}

/**
 * 正文落地、原作者正常消息处理结束后，再单独执行一次记录 API。
 * 这里只在调用 TableTwoStepSummary 的同步入口瞬间临时打开 step_by_step，
 * 让其通过原作者的入口检查；调用启动后立刻恢复 false。
 */
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
        return;
    } finally {
        // 绝不让旧 step_by_step 状态泄漏到正文流程或下一轮请求。
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
            }
        })
        .catch((error) => {
            handled.delete(chat);
            console.error('[Memo] 独立记录 API 执行异常:', error);
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

// 插件加载和切换设置后，常态始终保持普通模式；true 只允许短暂存在于上述两个受控入口。
forceNormalMode();

console.log('[Memo] 独立记录 API 已与 step_by_step 解耦：正文正常生成，落地后额外记录一次');
