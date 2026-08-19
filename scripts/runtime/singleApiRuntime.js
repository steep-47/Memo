import { APP, USER } from '../../core/manager.js';
import { getTablePrompt, handleEditStrInMessage } from '../../index.js';
import { replaceUserTag } from '../../utils/stringUtil.js';

const MEMO_MARK = '# Memo 单API记忆维护';
const EDIT_START = 'MEMO_TABLE_EDIT_START';
const EDIT_END = 'MEMO_TABLE_EDIT_END';
const NO_CHANGE = 'MEMO_NO_CHANGE';
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

# 强制输出协议
本轮回复无论是否发生状态变化，正文结束后都必须追加且只能追加一个以下区块，不能省略：
${EDIT_START}
（这里写 insertRow / updateRow / deleteRow；如果本轮确实没有任何应记录变化，只写 ${NO_CHANGE}）
${EDIT_END}

硬性要求：
- 每一轮都必须输出 ${EDIT_START} 与 ${EDIT_END}，不得自行判断为“无需输出”。
- 有任何应记录变化时，区块内必须写实际操作，每条操作单独一行。
- 完全没有变化时，区块内必须且只能写 ${NO_CHANGE}。
- 不要使用代码块，不要使用 HTML 注释，不要改写起止标记。
- 在输出 ${EDIT_END} 之前，不得结束本轮回复。
- 检查顺序：0当前状态→1角色状态→2背包→3当前任务与约定→4人物→5历史事件。
- 表1只记录玩家本人；NPC只进入表4。
- 同一人物已有记录优先 update，不因姓名、昵称、外号、道号、职衔或描述性称呼不同而重复 insert。
- NPC首次只有描述性称呼时可暂作姓名；正式名字确认后改用正式名字。
- 性别只记录明确事实；未知、没有、未提及的信息留空，不猜测、不写占位词。
- 属性统一使用“神识”；“神魂”仅在确实表示灵魂/魂魄本体时使用。
- ${EDIT_START} 到 ${EDIT_END} 之间只允许写 insertRow / updateRow / deleteRow 或 ${NO_CHANGE}。`);
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

function getRaw(chat) {
    return String(chat?.mes ?? chat?.content ?? '');
}

function setRaw(chat, value, previousRaw) {
    if ('mes' in chat) chat.mes = value;
    else chat.content = value;

    if (Array.isArray(chat.swipes) && Number.isInteger(chat.swipe_id) && chat.swipes[chat.swipe_id] === previousRaw) {
        chat.swipes[chat.swipe_id] = value;
    }
}

function extractPlainEditBlock(raw) {
    const start = raw.indexOf(EDIT_START);
    if (start === -1) return null;
    const end = raw.indexOf(EDIT_END, start + EDIT_START.length);
    if (end === -1) return null;

    return {
        start,
        end,
        actions: raw.slice(start + EDIT_START.length, end).trim(),
        afterEnd: end + EDIT_END.length,
    };
}

function normalizePlainEditBlock(chat) {
    const raw = getRaw(chat);
    const block = extractPlainEditBlock(raw);
    if (!block) return { found: false, hasActions: false };

    const before = raw.slice(0, block.start).trimEnd();
    const after = raw.slice(block.afterEnd).trimStart();
    const hasActions = /\b(?:insertRow|updateRow|deleteRow)\s*\(/.test(block.actions);

    if (!hasActions) {
        // 无变化区块只用于约束模型输出，落地后从用户可见正文中完全移除。
        const cleaned = `${before}${after ? `${before ? '\n' : ''}${after}` : ''}`;
        setRaw(chat, cleaned, raw);
        return { found: true, hasActions: false };
    }

    const converted = `${before}${before ? '\n' : ''}<tableEdit><!--\n${block.actions}\n--></tableEdit>${after ? `\n${after}` : ''}`;
    setRaw(chat, converted, raw);
    return { found: true, hasActions: true };
}

function hasCompleteEditBlock(raw) {
    const text = String(raw || '');
    return (text.includes(EDIT_START) && text.includes(EDIT_END)) || /<tableEdit>[\s\S]*?<\/tableEdit>/i.test(text);
}

function processAssistant(chat, source) {
    if (!chat || chat.is_user || processed.has(chat)) return false;
    const raw = getRaw(chat);
    if (!hasCompleteEditBlock(raw)) return false;

    try {
        let shouldExecute = /<tableEdit>[\s\S]*?<\/tableEdit>/i.test(raw);
        if (!shouldExecute) {
            const normalized = normalizePlainEditBlock(chat);
            if (!normalized.found) return false;
            shouldExecute = normalized.hasActions;
        }

        if (shouldExecute) handleEditStrInMessage(chat);
        processed.add(chat);
        USER.getContext()?.saveChat?.();
        console.log(`[Memo][single-api] 已从${source}捕获本轮记忆区块${shouldExecute ? '并执行写表' : '（无变化）'}`);
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

function mergeIntoPrimarySystem(chat, prompt) {
    const systemIndex = chat.findIndex(item => item?.role === 'system' && typeof item?.content === 'string');
    if (systemIndex >= 0) {
        chat[systemIndex].content = `${chat[systemIndex].content}\n\n${prompt}`;
        return;
    }
    chat.unshift({ role: 'system', content: prompt });
}

function appendUserReminder(chat) {
    for (let i = chat.length - 1; i >= 0; i--) {
        const item = chat[i];
        if (item?.role !== 'user' || typeof item?.content !== 'string') continue;
        item.content += `\n\n[Memo内部要求：本轮正常完成剧情后，必须在回复最末尾输出 ${EDIT_START} 到 ${EDIT_END}。有变化写表格操作；完全无变化只写 ${NO_CHANGE}。不要在正文解释此要求。]`;
        return;
    }
}

function onPromptReady(eventData) {
    if (!isSingleApiMode()) return;
    if (USER?.tableBaseSetting?.isExtensionAble === false) return;
    if (!Array.isArray(eventData?.chat) || alreadyInjected(eventData.chat)) return;

    const prompt = buildPrompt();
    if (!prompt) return;

    const startIndex = getChats().length - 1;

    // 兼容中转站：不再追加第二个 system message，而是并入请求原本的主 system。
    mergeIntoPrimarySystem(eventData.chat, prompt);
    // 再给本轮 user 消息一个极短提醒，防止兼容层弱化 system 指令。
    appendUserReminder(eventData.chat);

    startPolling(startIndex);
    console.log('[Memo][single-api] 强制记忆协议已合并进主 system，并附加本轮 user 提醒');
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

console.log('[Memo] 单API代理兼容运行链已加载：主system合并 + user提醒 + 强制每轮记忆区块');
