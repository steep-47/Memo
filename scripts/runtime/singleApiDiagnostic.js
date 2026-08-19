import { APP, EDITOR, USER } from '../../core/manager.js';
import { getTableEditTag, initTableData } from '../../index.js';

const PREF_KEY = 'independent_record_api_enabled';
let lastPromptState = null;

function independentEnabled() {
    return USER?.getSettings?.()?.muyoo_dataTable?.[PREF_KEY] === true;
}

function isMemoPrompt(content) {
    const text = String(content ?? '');
    return text.includes('# dataTable 世界状态记忆') ||
        (text.includes('<tableEdit>') && text.includes('insertRow('));
}

function getRole() {
    switch (USER.tableBaseSetting.injection_mode) {
        case 'deep_user': return 'user';
        case 'deep_assistant': return 'assistant';
        default: return 'system';
    }
}

function ensureMemoPrompt(eventData) {
    if (independentEnabled() ||
        eventData?.dryRun === true ||
        USER.tableBaseSetting.isExtensionAble === false ||
        USER.tableBaseSetting.isAiReadTable === false ||
        USER.tableBaseSetting.injection_mode === 'injection_off') {
        lastPromptState = null;
        return;
    }

    const chat = Array.isArray(eventData?.chat) ? eventData.chat : [];
    let promptFound = chat.some(message => isMemoPrompt(message?.content));
    let fallbackInjected = false;

    if (!promptFound) {
        try {
            const promptContent = initTableData(eventData);
            if (promptContent?.trim()) {
                const message = { role: getRole(), content: promptContent };
                const deep = Number(USER.tableBaseSetting.deep) || 0;
                if (deep <= 0 || deep >= chat.length) chat.push(message);
                else chat.splice(-deep, 0, message);
                promptFound = true;
                fallbackInjected = true;
            }
        } catch (error) {
            console.error('[Memo] 一次API提示兜底失败', error);
        }
    }

    // 只为真正带入 Memo 提示的请求登记响应诊断。
    // 新建聊天/开局欢迎语等 CHARACTER_MESSAGE_RENDERED 也会触发，
    // 但它们并不一定对应一次聊天 API 请求，不能因此误报“提示补入失败”。
    lastPromptState = promptFound ? { promptFound: true, fallbackInjected } : null;
}

function checkResponse(chatId) {
    if (independentEnabled() || !lastPromptState) return;

    // 一次请求只诊断一次，避免状态残留到新游戏/欢迎语等后续渲染事件。
    const promptState = lastPromptState;
    lastPromptState = null;

    const chat = USER?.getContext?.()?.chat?.[chatId];
    if (!chat || chat.is_user === true) return;

    const { matches } = getTableEditTag(String(chat.mes ?? ''));
    const joined = matches?.join('\n') ?? '';
    if (/(?:insertRow|updateRow|deleteRow)\s*\(/.test(joined) || /NO_CHANGE/.test(joined)) return;

    EDITOR.warning(promptState.fallbackInjected
        ? '一次API诊断：已补入Memo提示，但模型未完成tableEdit收尾'
        : '一次API诊断：提示已注入，但模型未完成tableEdit收尾');
}

const promptEvent = APP.event_types.CHAT_COMPLETION_PROMPT_READY;
APP.eventSource.on(promptEvent, ensureMemoPrompt);
if (typeof APP.eventSource.makeLast === 'function') APP.eventSource.makeLast(promptEvent, ensureMemoPrompt);
APP.eventSource.on(APP.event_types.CHARACTER_MESSAGE_RENDERED, checkResponse);
