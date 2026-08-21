import { APP, EDITOR, USER } from '../../core/manager.js';
import { getTableEditTag, initTableData } from '../../index.js';
import { TableTwoStepSummary } from './separateTableUpdate.js';

const PREF_KEY = 'independent_record_api_enabled';
let lastPromptState = null;
const fallbackHandled = new WeakSet();
let fallbackRunning = false;

const FINAL_REMINDER_MARKER = '[Memo最终输出阶段]';
const FINAL_REMINDER = `${FINAL_REMINDER_MARKER}\n本轮输出固定分为三个连续阶段：\n阶段1：正常完成剧情/回答主体事实。\n阶段2：主体事实结束后立即检查七张表，并输出一个完整<tableEdit>...</tableEdit>；即使无变化也必须输出<tableEdit><!-- NO_CHANGE --></tableEdit>。\n阶段3：tableEdit之后再写参考行动、选项、伊依留言或其他回复尾部内容，然后正常结束。\n禁止把tableEdit拖到选项/留言之后，也禁止在阶段1结束回复。`;

function independentEnabled() { return USER?.getSettings?.()?.muyoo_dataTable?.[PREF_KEY] === true; }
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
    const tail = compactTail(value);
    if (hasOpen && !hasClose) return `tableEdit未闭合｜回复${length}字｜末尾：${tail}`;
    if (!hasOpen && hasClose) return `仅出现tableEdit结束标签｜回复${length}字｜末尾：${tail}`;
    if (!hasOpen && !hasClose) return `无tableEdit｜回复${length}字｜末尾：${tail}`;
    return `tableEdit格式/内容未被识别｜回复${length}字｜末尾：${tail}`;
}

function ensureMemoPrompt(eventData) {
    if (independentEnabled() || eventData?.dryRun === true || USER.tableBaseSetting.isExtensionAble === false || USER.tableBaseSetting.isAiReadTable === false || USER.tableBaseSetting.injection_mode === 'injection_off') {
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
    lastPromptState = promptFound ? { promptFound: true, fallbackInjected } : null;
}

async function recoverMissingTableEdit(chat, detail, promptState) {
    if (fallbackRunning || fallbackHandled.has(chat) || independentEnabled()) return;
    fallbackHandled.add(chat);
    fallbackRunning = true;

    EDITOR.warning(promptState.fallbackInjected
        ? `一次API诊断：已补入Memo提示，但模型未完成tableEdit阶段｜${detail}｜正在自动补记...`
        : `一次API诊断：提示已注入，但模型未完成tableEdit阶段｜${detail}｜正在自动补记...`);

    try {
        const result = await TableTwoStepSummary('fallback');
        if (result === true) {
            EDITOR.success('一次API补记完成！');
            console.log('[Memo] 一次API漏tableEdit：已通过fallback补记成功');
        } else {
            fallbackHandled.delete(chat);
            EDITOR.warning('一次API补记失败：正文已保留，但本轮表格仍未成功写入。');
            console.warn('[Memo] 一次APIfallback未完成写入');
        }
    } catch (error) {
        fallbackHandled.delete(chat);
        EDITOR.warning(`一次API补记异常：${error?.message || error}`);
        console.error('[Memo] 一次APIfallback异常', error);
    } finally {
        fallbackRunning = false;
    }
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
    void recoverMissingTableEdit(chat, detail, promptState);
}

const promptEvent = APP.event_types.CHAT_COMPLETION_PROMPT_READY;
APP.eventSource.on(promptEvent, ensureMemoPrompt);
if (typeof APP.eventSource.makeLast === 'function') APP.eventSource.makeLast(promptEvent, ensureMemoPrompt);
APP.eventSource.on(APP.event_types.CHARACTER_MESSAGE_RENDERED, checkResponse);

console.log('[Memo] 一次API诊断已启用：漏tableEdit时仅失败轮自动补记一次');
