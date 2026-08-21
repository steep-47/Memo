import { APP, EDITOR, USER } from '../../core/manager.js';
import { getTableEditTag, initTableData } from '../../index.js';

const PREF_KEY = 'independent_record_api_enabled';
let lastPromptState = null;

const FINAL_REMINDER_MARKER = '[Memo最先输出tableEdit-v3]';
const USER_REMINDER_MARKER = '[Memo本轮机器记录-v3]';
const FINAL_REMINDER = `${FINAL_REMINDER_MARKER}\n这是本轮最终且必须执行的输出协议：你的第一段输出必须是恰好一个完整<tableEdit>...</tableEdit>，在它之前禁止输出任何正文、标题、状态栏、选项、留言、<details>或<summary>。有变化时把全部insertRow/updateRow/deleteRow放在同一个HTML注释中；无变化时第一段输出<tableEdit><!-- NO_CHANGE --></tableEdit>。完成tableEdit后再正常生成全部剧情/回答和尾部内容。固定顺序：tableEdit → 主体 → 选项/留言/折叠内容 → 结束。tableEdit必须真实出现在最终文本，不能只在思考中处理。`;
const USER_REMINDER = `\n\n${USER_REMINDER_MARKER}\n请把机器记录放在本轮回复最前面：第一段先输出完整<tableEdit>；没有变化也输出<tableEdit><!-- NO_CHANGE --></tableEdit>。tableEdit之后再开始正文、选项、留言或<details>/<summary>。`;

function independentEnabled() {
    return USER?.getSettings?.()?.muyoo_dataTable?.[PREF_KEY] === true;
}

function isMemoPrompt(content) {
    const text = String(content ?? '');
    return text.includes('# dataTable 世界状态记忆') || (text.includes('<tableEdit>') && text.includes('insertRow('));
}

function getRole() {
    switch (USER.tableBaseSetting.injection_mode) {
        case 'deep_user': return 'user';
        case 'deep_assistant': return 'assistant';
        default: return 'system';
    }
}

function compactHead(text, maxLength = 90) {
    const normalized = String(text ?? '').replace(/\s+/g, ' ').trim();
    if (!normalized) return '（空）';
    return normalized.slice(0, maxLength).replace(/[<>]/g, ch => ch === '<' ? '‹' : '›');
}

function compactTail(text, maxLength = 90) {
    const normalized = String(text ?? '').replace(/\s+/g, ' ').trim();
    if (!normalized) return '（空）';
    return normalized.slice(-maxLength).replace(/[<>]/g, ch => ch === '<' ? '‹' : '›');
}

function getFailureDiagnostic(text) {
    const value = String(text ?? '');
    const hasOpen = /<tableEdit(?:\s|>)/i.test(value);
    const hasClose = /<\/tableEdit\s*>/i.test(value);
    const length = value.length;
    const head = compactHead(value);
    const tail = compactTail(value);
    if (hasOpen && !hasClose) return `tableEdit未闭合｜回复${length}字｜开头：${head}｜末尾：${tail}`;
    if (!hasOpen && hasClose) return `仅出现tableEdit结束标签｜回复${length}字｜开头：${head}`;
    if (!hasOpen && !hasClose) return `无tableEdit｜回复${length}字｜开头：${head}｜末尾：${tail}`;
    return `tableEdit格式/内容未被识别｜回复${length}字｜开头：${head}`;
}

function reinforceLatestUserMessage(chat) {
    for (let i = chat.length - 1; i >= 0; i--) {
        const message = chat[i];
        if (message?.role !== 'user' || typeof message.content !== 'string') continue;
        if (!message.content.includes(USER_REMINDER_MARKER)) {
            message.content = `${message.content}${USER_REMINDER}`;
        }
        return true;
    }
    return false;
}

function ensureMemoPrompt(eventData) {
    if (
        independentEnabled() ||
        eventData?.dryRun === true ||
        USER.tableBaseSetting.isExtensionAble === false ||
        USER.tableBaseSetting.isAiReadTable === false ||
        USER.tableBaseSetting.injection_mode === 'injection_off'
    ) {
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

    if (promptFound) {
        reinforceLatestUserMessage(chat);
        if (!chat.some(message => String(message?.content ?? '').includes(FINAL_REMINDER_MARKER))) {
            chat.push({ role: 'system', content: FINAL_REMINDER });
        }
    }

    lastPromptState = promptFound ? { promptFound: true, fallbackInjected } : null;
}

function checkResponse(chatId) {
    if (independentEnabled() || !lastPromptState) return;
    const promptState = lastPromptState;
    lastPromptState = null;

    const chat = USER?.getContext?.()?.chat?.[chatId];
    if (!chat || chat.is_user === true) return;

    const responseText = String(chat.mes ?? '');
    const { matches } = getTableEditTag(responseText);
    const joined = matches?.join('\n') ?? '';
    if (/(?:insertRow|updateRow|deleteRow)\s*\(/.test(joined) || /NO_CHANGE/.test(joined)) return;

    const detail = getFailureDiagnostic(responseText);
    EDITOR.warning(
        promptState.fallbackInjected
            ? `一次API诊断：已补入Memo提示，但模型仍未先输出tableEdit｜${detail}`
            : `一次API诊断：提示已注入，但模型仍未先输出tableEdit｜${detail}`
    );
}

const promptEvent = APP.event_types.CHAT_COMPLETION_PROMPT_READY;
APP.eventSource.on(promptEvent, ensureMemoPrompt);
if (typeof APP.eventSource.makeLast === 'function') APP.eventSource.makeLast(promptEvent, ensureMemoPrompt);
APP.eventSource.on(APP.event_types.CHARACTER_MESSAGE_RENDERED, checkResponse);

console.log('[Memo] 严格一次API诊断已启用：tableEdit-first，失败只提示、不补记');
