import { APP, USER } from '../../core/manager.js';
import { getTablePrompt, handleEditStrInMessage } from '../../index.js';
import { replaceUserTag } from '../../utils/stringUtil.js';

const MEMO_MARK = '# Memo 单API记忆维护';
const EDIT_START = 'MEMO_TABLE_EDIT_START';
const EDIT_END = 'MEMO_TABLE_EDIT_END';
const POLL_INTERVAL = 500;
const POLL_TIMEOUT = 120000;

let pendingRun = null;
let runSerial = 0;
const processed = new WeakSet();

function isSingleApiMode() {
    return USER?.tableBaseSetting?.step_by_step !== true;
}

function buildPrompt() {
    const tableData = getTablePrompt(undefined, false);
    if (!tableData) return '';

    return replaceUserTag(`${MEMO_MARK}
你需要在正常完成本轮剧情回复的同时维护以下六张记忆表。正文照常输出，不要向用户解释记忆维护。

${tableData}

# 写表协议（必须严格遵守）
如果本轮出现任何需要新增、修改或删除的表格事实，必须在整段正文最后追加以下纯文本区块：
${EDIT_START}
insertRow(tableIndex,{列号:值})
updateRow(tableIndex,rowIndex,{列号:值})
deleteRow(tableIndex,rowIndex)
${EDIT_END}

要求：
- 只输出实际需要的操作；每条操作单独一行。
- 不要把该区块放进代码块，不要使用HTML注释，不要改写起止标记。
- 只要本轮有应记录变化，就必须输出该区块；完全没有变化时才可省略。
- 检查顺序：0当前状态→1角色状态→2背包→3当前任务与约定→4人物→5历史事件。
- 表1只记录玩家本人；NPC只进入表4。
- 同一人物已有记录优先update，不因姓名、昵称、外号、道号、职衔或描述性称呼不同而重复insert。
- NPC首次只有描述性称呼时可暂作姓名；正式名字确认后改用正式名字。
- 性别只记录明确事实；未知、没有、未提及的信息留空，不猜测、不写占位词。
- 属性统一使用“神识”；“神魂”仅在确实表示灵魂/魂魄本体时使用。
- ${EDIT_START} 到 ${EDIT_END} 之间只允许写 insertRow / updateRow / deleteRow。`);
}

function alreadyInjected(chat) {
    return Array.isArray(chat) && chat.some(item => String(item?.content || '').includes(MEMO_MARK));
}

function getChats() {
    return USER.getContext()?.chat || [];
}

function getLatestAssistantAfter(minIndex = -1) {
    const chats = getChats();
    for (let i = chats.length - 1; i > minIndex; i--) {
        const chat = chats[i];
        if (chat && chat.is_user !== true) return { chat, index: i };
    }
    return { chat: null, index: -1 };
}

function normalizePlainEditBlock(chat) {
    const raw = String(chat?.mes ?? chat?.content ?? '');
    if (!raw.includes(EDIT_START) || !raw.includes(EDIT_END)) return false;

    const start = raw.indexOf(EDIT_START);
    const end = raw.indexOf(EDIT_END, start + EDIT_START.length);
    if (end === -1) return false;

    const actions = raw.slice(start + EDIT_START.length, end).trim();
    const before = raw.slice(0, start).trimEnd();
    const after = raw.slice(end + EDIT_END.length).trimStart();
    const converted = `${before}${before ? '\n' : ''}<tableEdit><!--\n${actions}\n--></tableEdit>${after ? `\n${after}` : ''}`;

    if ('mes' in chat) chat.mes = converted;
    else chat.content = converted;

    if (Array.isArray(chat.swipes) && Number.isInteger(chat.swipe_id) && chat.swipes[chat.swipe_id] === raw) {
        chat.swipes[chat.swipe_id] = converted;
    }
    return true;
}

function hasCompleteEditBlock(raw) {
    const text = String(raw || '');
    return (text.includes(EDIT_START) && text.includes(EDIT_END)) || /<tableEdit>[\s\S]*?<\/tableEdit>/i.test(text);
}

function processAssistant(chat, source) {
    if (!chat || chat.is_user || processed.has(chat)) return false;
    const raw = String(chat.mes ?? chat.content ?? '');
    if (!hasCompleteEditBlock(raw)) return false;

    try {
        normalizePlainEditBlock(chat);
        handleEditStrInMessage(chat);
        processed.add(chat);
        USER.getContext()?.saveChat?.();
        console.log(`[Memo][single-api] 已从${source}捕获并执行写表指令`);
        return true;
    } catch (error) {
        console.error(`[Memo][single-api] ${source}写表解析失败:`, error);
        return false;
    }
}

function stopPolling(serial) {
    if (pendingRun?.serial !== serial) return;
    if (pendingRun.timer) clearInterval(pendingRun.timer);
    pendingRun = null;
}

function startPolling(startIndex) {
    const serial = ++runSerial;
    if (pendingRun?.timer) clearInterval(pendingRun.timer);

    const startedAt = Date.now();
    pendingRun = { serial, startIndex, startedAt, timer: null };
    pendingRun.timer = setInterval(() => {
        if (!isSingleApiMode()) return stopPolling(serial);
        if (Date.now() - startedAt > POLL_TIMEOUT) return stopPolling(serial);

        const { chat } = getLatestAssistantAfter(startIndex);
        if (!chat) return;
        if (processAssistant(chat, 'chat轮询')) stopPolling(serial);
    }, POLL_INTERVAL);
}

function onPromptReady(eventData) {
    if (!isSingleApiMode()) return;
    if (USER?.tableBaseSetting?.isExtensionAble === false) return;
    if (!Array.isArray(eventData?.chat) || alreadyInjected(eventData.chat)) return;

    const prompt = buildPrompt();
    if (!prompt) return;

    const startIndex = getChats().length - 1;
    eventData.chat.push({ role: 'system', content: prompt });
    startPolling(startIndex);
    console.log('[Memo][single-api] 代理兼容写表协议已注入主请求');
}

function tryEventChat(chatId, source) {
    if (!isSingleApiMode()) return;
    if (USER?.tableBaseSetting?.isExtensionAble === false || USER?.tableBaseSetting?.isAiWriteTable === false) return;

    let chat = Number.isInteger(Number(chatId)) ? getChats()[Number(chatId)] : null;
    if (!chat || chat.is_user) chat = getLatestAssistantAfter(pendingRun?.startIndex ?? -1).chat;
    if (!chat) return;

    if (processAssistant(chat, source) && pendingRun) stopPolling(pendingRun.serial);
}

APP.eventSource.on(APP.event_types.CHAT_COMPLETION_PROMPT_READY, onPromptReady);
APP.eventSource.on(APP.event_types.CHARACTER_MESSAGE_RENDERED, id => tryEventChat(id, 'CHARACTER_MESSAGE_RENDERED'));
APP.eventSource.on(APP.event_types.MESSAGE_RECEIVED, id => tryEventChat(id, 'MESSAGE_RECEIVED'));
APP.eventSource.on(APP.event_types.GENERATION_ENDED, () => tryEventChat(undefined, 'GENERATION_ENDED'));

console.log('[Memo] 单API代理兼容运行链已加载：纯文本写表协议 + 最终消息直读');
