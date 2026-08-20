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

    if (hasOpen && !hasClose) return `tableEdit未闭合｜回复${length}字｜末尾：${tail}`;
    if (!hasOpen && hasClose) return `仅出现tableEdit结束标签｜回复${length}字｜末尾：${tail}`;
    if (!hasOpen && !hasClose) return `无tableEdit｜回复${length}字｜末尾：${tail}`;
    return `tableEdit格式/内容未被识别｜回复${length}字｜末尾：${tail}`;
}

function makeRequestSnapshot(chat) {
    const messages = Array.isArray(chat) ? chat : [];
    const memoIndexes = [];
    const reminderIndexes = [];

    messages.forEach((message, index) => {
        const content = String(message?.content ?? '');
        if (isMemoPrompt(content)) memoIndexes.push(index);
        if (content.includes(FINAL_REMINDER_MARKER)) reminderIndexes.push(index);
    });

    const lastIndex = messages.length - 1;
    const reminderIndex = reminderIndexes.length ? reminderIndexes[reminderIndexes.length - 1] : -1;
    const memoIndex = memoIndexes.length ? memoIndexes[memoIndexes.length - 1] : -1;
    const lastRole = lastIndex >= 0 ? String(messages[lastIndex]?.role ?? '?') : '无';
    const reminderIsLast = reminderIndex === lastIndex;
    const afterReminder = reminderIndex >= 0 ? Math.max(0, lastIndex - reminderIndex) : -1;

    return {
        messageCount: messages.length,
        memoIndex,
        reminderIndex,
        reminderIsLast,
        afterReminder,
        lastRole,
    };
}

function snapshotSummary(snapshot) {
    if (!snapshot) return '请求快照=无';
    const pos = index => index >= 0 ? `${index + 1}/${snapshot.messageCount}` : '无';
    const last = snapshot.reminderIsLast ? '收尾提示=最后一条✓' : '收尾提示=非最后一条✗';
    const after = snapshot.afterReminder >= 0 ? `其后${snapshot.afterReminder}条` : '其后未知';
    return `${last}｜messages=${snapshot.messageCount}｜Memo=${pos(snapshot.memoIndex)}｜收尾=${pos(snapshot.reminderIndex)}｜${after}｜末条role=${snapshot.lastRole}`;
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

    if (promptFound && !chat.some(message => String(message?.content ?? '').includes(FINAL_REMINDER_MARKER))) {
        chat.push({ role: 'system', content: FINAL_REMINDER });
    }

    // 在真正发送前记录最终 messages 的位置关系；只观测，不修改请求内容。
    const requestSnapshot = promptFound ? makeRequestSnapshot(chat) : null;
    lastPromptState = promptFound ? { promptFound: true, fallbackInjected, requestSnapshot } : null;
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
    const request = snapshotSummary(promptState.requestSnapshot);
    EDITOR.warning(promptState.fallbackInjected
        ? `一次API诊断：已补入Memo提示，但模型未完成tableEdit收尾｜${detail}｜${request}`
        : `一次API诊断：提示已注入，但模型未完成tableEdit收尾｜${detail}｜${request}`);
}

const promptEvent = APP.event_types.CHAT_COMPLETION_PROMPT_READY;
APP.eventSource.on(promptEvent, ensureMemoPrompt);
if (typeof APP.eventSource.makeLast === 'function') APP.eventSource.makeLast(promptEvent, ensureMemoPrompt);
APP.eventSource.on(APP.event_types.CHARACTER_MESSAGE_RENDERED, checkResponse);
