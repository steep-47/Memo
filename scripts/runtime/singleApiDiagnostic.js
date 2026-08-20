import { APP, EDITOR, USER } from '../../core/manager.js';
import { getTableEditTag, initTableData } from '../../index.js';

const PREF_KEY = 'independent_record_api_enabled';
let lastPromptState = null;

const FINAL_REMINDER_MARKER = '[Memo最终输出阶段]';
const FINAL_REMINDER = `${FINAL_REMINDER_MARKER}\n本轮输出固定分为两个连续阶段：\n阶段1：正常完成正文、状态栏、选项、留言等全部可见内容。\n阶段2：紧接阶段1，执行Memo表格更新并输出<tableEdit>...</tableEdit>。阶段2是本轮回复的一部分，不是附加任务，也不是下一轮。即使没有任何表格变化，也必须输出<tableEdit><!-- NO_CHANGE --></tableEdit>。\n禁止在阶段1结束回复；</tableEdit>是唯一允许的整轮结束位置。`;

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

function compactTail(text, maxLength = 90) {
    const normalized = String(text ?? '').replace(/\s+/g, ' ').trim();
    if (!normalized) return '（空）';
    const tail = normalized.slice(-maxLength);
    return tail.replace(/[<>]/g, ch => ch === '<' ? '‹' : '›');
}

function getFailureDiagnostic(text) {
    const value = String(text ?? '');
    const hasOpen = /<tableEdit(?:\s|>)/i.test(value);
    const hasClose = /<\/tableEdit\s*>/i.test(value);
    const length = value.length;
    const tail = compactTail(value);

    if (hasOpen && !hasClose) {
        return `tableEdit未闭合｜回复${length}字｜末尾：${tail}`;
    }
    if (!hasOpen && hasClose) {
        return `仅出现tableEdit结束标签｜回复${length}字｜末尾：${tail}`;
    }
    if (!hasOpen && !hasClose) {
        return `无tableEdit｜回复${length}字｜末尾：${tail}`;
    }
    return `tableEdit格式/内容未被识别｜回复${length}字｜末尾：${tail}`;
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

    // 主 Memo 提示仍负责表格规则本身。这里不重复规则，只把一次回复明确拆成
    // “正文 -> Memo收尾”两个连续输出阶段，降低模型在正文/选项/留言处自然停笔的概率。
    // 这仍然只是同一次请求中的最后一条 system message，不产生额外 API。
    if (promptFound && !chat.some(message => String(message?.content ?? '').includes(FINAL_REMINDER_MARKER))) {
        chat.push({ role: 'system', content: FINAL_REMINDER });
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

    const responseText = String(chat.mes ?? '');
    const { matches } = getTableEditTag(responseText);
    const joined = matches?.join('\n') ?? '';
    if (/(?:insertRow|updateRow|deleteRow)\s*\(/.test(joined) || /NO_CHANGE/.test(joined)) return;

    const detail = getFailureDiagnostic(responseText);
    EDITOR.warning(promptState.fallbackInjected
        ? `一次API诊断：已补入Memo提示，但模型未完成tableEdit收尾｜${detail}`
        : `一次API诊断：提示已注入，但模型未完成tableEdit收尾｜${detail}`);
}

const promptEvent = APP.event_types.CHAT_COMPLETION_PROMPT_READY;
APP.eventSource.on(promptEvent, ensureMemoPrompt);
if (typeof APP.eventSource.makeLast === 'function') APP.eventSource.makeLast(promptEvent, ensureMemoPrompt);
APP.eventSource.on(APP.event_types.CHARACTER_MESSAGE_RENDERED, checkResponse);
