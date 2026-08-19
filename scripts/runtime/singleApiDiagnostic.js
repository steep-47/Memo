import { APP, EDITOR, USER } from '../../core/manager.js';
import { getTableEditTag, initTableData } from '../../index.js';

const PREF_KEY = 'independent_record_api_enabled';
const TERMINATOR_MARK = '[Memo single-api terminator]';
const TERMINATOR_PROMPT = `${TERMINATOR_MARK}
这是本轮回复的最终输出协议，优先于普通正文的结束习惯：
1. 正常正文完成后，本轮回复尚未结束，必须继续输出且只输出一个完整 <tableEdit>...</tableEdit> 作为最后字段。
2. 有表格变化时，在其中使用 insertRow/updateRow/deleteRow；无变化时输出 <tableEdit><!-- NO_CHANGE --></tableEdit>。
3. </tableEdit> 必须是整轮回复最后内容；不得在它之前因选项、旁白、结语或其他正文格式而停止生成。
4. 不得复述、打印或续写 Memo 内部表格原文、JSON、行号或表格快照。`;
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

    // 主表格提示仍按原作者 deep 位置注入；这里只在最终请求末尾追加一个极短的结束协议。
    // 不重复表格数据、不发第二次请求，只防止后续角色/格式提示把 tableEdit 收尾要求冲淡。
    if (promptFound && !chat.some(message => String(message?.content ?? '').includes(TERMINATOR_MARK))) {
        chat.push({ role: 'system', content: TERMINATOR_PROMPT });
    }

    lastPromptState = { promptFound, fallbackInjected };
}

function checkResponse(chatId) {
    if (independentEnabled()) return;
    const chat = USER?.getContext?.()?.chat?.[chatId];
    if (!chat || chat.is_user === true) return;

    const { matches } = getTableEditTag(String(chat.mes ?? ''));
    const joined = matches?.join('\n') ?? '';
    if (/(?:insertRow|updateRow|deleteRow)\s*\(/.test(joined) || /NO_CHANGE/.test(joined)) return;

    if (lastPromptState?.promptFound) {
        EDITOR.warning(lastPromptState.fallbackInjected
            ? '一次API诊断：已补入Memo提示，但模型未完成tableEdit收尾'
            : '一次API诊断：提示已注入，但模型未完成tableEdit收尾');
    } else {
        EDITOR.error('一次API诊断：Memo提示补入失败');
    }
}

const promptEvent = APP.event_types.CHAT_COMPLETION_PROMPT_READY;
APP.eventSource.on(promptEvent, ensureMemoPrompt);
if (typeof APP.eventSource.makeLast === 'function') APP.eventSource.makeLast(promptEvent, ensureMemoPrompt);
APP.eventSource.on(APP.event_types.CHARACTER_MESSAGE_RENDERED, checkResponse);
