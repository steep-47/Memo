import { APP, USER } from '../../core/manager.js';
import { getTablePrompt, handleEditStrInMessage } from '../../index.js';
import { replaceUserTag } from '../../utils/stringUtil.js';

const MEMO_MARK = '# Memo 单API记忆维护';
const DIAG_EVENT = 'memo-single-api-diagnostic';

function reportDiagnostic(detail) {
    try {
        window.dispatchEvent(new CustomEvent(DIAG_EVENT, { detail }));
    } catch (_) {}
}

function isSingleApiMode() {
    return USER?.tableBaseSetting?.step_by_step !== true;
}

function buildPrompt() {
    const tableData = getTablePrompt(undefined, false);
    if (!tableData) return '';

    return replaceUserTag(`${MEMO_MARK}
你需要在正常完成本轮剧情回复的同时，维护以下六张记忆表。不要向用户解释表格维护过程。

${tableData}

# 写表格式
仅在确有变化时，于整段回复最末尾输出一个：
<tableEdit><!--
insertRow(tableIndex,{列号:值})
updateRow(tableIndex,rowIndex,{列号:值})
deleteRow(tableIndex,rowIndex)
--></tableEdit>

# 规则
- 检查顺序：0当前状态→1角色状态→2背包→3当前任务与约定→4人物→5历史事件。
- 表1只记录玩家本人；NPC只进入表4。
- 同一人物已有记录优先update，不因姓名、昵称、外号、道号、职衔或描述性称呼不同而重复insert。
- NPC首次只有描述性称呼时可暂作姓名；正式名字确认后改用正式名字。
- 性别只记录明确事实；未知、没有、未提及的信息留空，不猜测、不写占位词。
- 属性统一使用“神识”；“神魂”仅在确实表示灵魂/魂魄本体时使用。
- 没有任何变化时不要输出<tableEdit>。
- <tableEdit>是后台机器指令，不属于正文。`);
}

function alreadyInjected(chat) {
    return Array.isArray(chat) && chat.some(item => String(item?.content || '').includes(MEMO_MARK));
}

function analyzeRaw(raw, source) {
    const text = String(raw || '');
    const hasOpenTag = /<tableEdit\b/i.test(text);
    const hasCloseTag = /<\/tableEdit>/i.test(text);
    const hasAction = /\b(?:insertRow|updateRow|deleteRow)\s*\(/.test(text);
    reportDiagnostic({
        stage: 'response',
        source,
        status: hasOpenTag && hasAction ? 'tableedit-detected' : 'tableedit-missing',
        hasOpenTag,
        hasCloseTag,
        hasAction,
        length: text.length,
    });
}

function getLatestAssistant() {
    const chats = USER.getContext()?.chat || [];
    for (let i = chats.length - 1; i >= 0; i--) {
        if (chats[i] && chats[i].is_user !== true) return { chat: chats[i], index: i };
    }
    return { chat: null, index: -1 };
}

function onPromptReady(eventData) {
    if (!isSingleApiMode()) return;
    if (USER?.tableBaseSetting?.isExtensionAble === false) return;
    if (!Array.isArray(eventData?.chat) || alreadyInjected(eventData.chat)) return;

    const prompt = buildPrompt();
    if (!prompt) {
        reportDiagnostic({ stage: 'prompt', status: 'no-prompt' });
        return;
    }

    eventData.chat.push({ role: 'system', content: prompt });
    reportDiagnostic({ stage: 'prompt', status: 'injected' });
    console.log('[Memo][single-api] 写表协议已直接注入主请求');
}

function onMessageRendered(chatId) {
    if (!isSingleApiMode()) return;
    if (USER?.tableBaseSetting?.isExtensionAble === false || USER?.tableBaseSetting?.isAiWriteTable === false) return;

    const chat = USER.getContext()?.chat?.[chatId];
    if (!chat || chat.is_user) return;

    analyzeRaw(chat.mes ?? chat.content ?? '', 'CHARACTER_MESSAGE_RENDERED');

    try {
        handleEditStrInMessage(chat);
        console.log('[Memo][single-api] 主回复写表解析完成');
    } catch (error) {
        reportDiagnostic({ stage: 'parse', status: 'parse-error', message: String(error?.message || error) });
        console.error('[Memo][single-api] 主回复写表解析失败:', error);
    }
}

function onMessageReceived(chatId) {
    if (!isSingleApiMode()) return;
    const chat = USER.getContext()?.chat?.[chatId];
    if (!chat || chat.is_user) return;
    analyzeRaw(chat.mes ?? chat.content ?? '', 'MESSAGE_RECEIVED');
}

function onGenerationEnded() {
    if (!isSingleApiMode()) return;
    const { chat } = getLatestAssistant();
    if (!chat) return;
    analyzeRaw(chat.mes ?? chat.content ?? '', 'GENERATION_ENDED');
}

APP.eventSource.on(APP.event_types.CHAT_COMPLETION_PROMPT_READY, onPromptReady);
APP.eventSource.on(APP.event_types.CHARACTER_MESSAGE_RENDERED, onMessageRendered);
APP.eventSource.on(APP.event_types.MESSAGE_RECEIVED, onMessageReceived);
APP.eventSource.on(APP.event_types.GENERATION_ENDED, onGenerationEnded);

console.log('[Memo] 单API专用运行链已加载（含多事件诊断）');
