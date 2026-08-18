import { APP, BASE, USER } from '../../core/manager.js';
import { getTablePrompt, handleEditStrInMessage } from '../../index.js';
import { replaceUserTag } from '../../utils/stringUtil.js';

const MEMO_MARK = '# Memo 单API记忆维护';
const EXPECTED_SHEETS = ['当前状态表','角色状态表','背包表','当前任务与约定表','人物表','历史事件表'];

function isSingleApiMode() {
    return USER?.tableBaseSetting?.step_by_step !== true;
}

function hasSixSheets() {
    try {
        const names = new Set((BASE.getChatSheets?.() || []).map(sheet => sheet?.name).filter(Boolean));
        return EXPECTED_SHEETS.every(name => names.has(name));
    } catch (_) {
        return false;
    }
}

function ensureFreshChatSheets() {
    try {
        // 新聊天最常见情况是 chatMetadata.sheets 为空。只在完全没有聊天表格时强制建表，
        // 绝不对已有表格的聊天执行重建，避免覆盖旧数据。
        const contextSheets = BASE?.sheetsData?.context;
        if (!Array.isArray(contextSheets) || contextSheets.length === 0) {
            BASE.initHashSheet(true);
        }

        // 若上下文已有表，但缓存尚未就绪，读取一次使 Sheet 实例建立。
        BASE.getChatSheets?.();
        return hasSixSheets();
    } catch (error) {
        console.error('[Memo][single-api] 新聊天六表初始化失败:', error);
        return false;
    }
}

function buildPrompt() {
    // 发送主请求前再次确认当前聊天已有六张表，解决新聊天 CHAT_CHANGED 与首轮生成的时序竞争。
    if (!ensureFreshChatSheets()) {
        console.warn('[Memo][single-api] 当前聊天六表尚未就绪，本轮不注入空协议');
        return '';
    }

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

function onPromptReady(eventData) {
    if (!isSingleApiMode()) return;
    if (USER?.tableBaseSetting?.isExtensionAble === false) return;
    if (!Array.isArray(eventData?.chat) || alreadyInjected(eventData.chat)) return;

    const prompt = buildPrompt();
    if (!prompt) return;

    // 直接追加为本轮最后一条 system 指令，不再依赖旧 injection_mode/deep/message_template。
    eventData.chat.push({ role: 'system', content: prompt });
    console.log('[Memo][single-api] 写表协议已直接注入主请求');
}

async function onMessageRendered(chatId) {
    if (!isSingleApiMode()) return;
    if (USER?.tableBaseSetting?.isExtensionAble === false || USER?.tableBaseSetting?.isAiWriteTable === false) return;

    const chat = USER.getContext()?.chat?.[chatId];
    if (!chat || chat.is_user) return;

    try {
        // 第一条AI回复到达时再做一次保险；此时已经有可挂载 hash_sheets 的非用户消息。
        ensureFreshChatSheets();
        handleEditStrInMessage(chat);
        await USER.saveChat?.();
        BASE.refreshContextView?.();
        console.log('[Memo][single-api] 主回复写表解析并保存完成');
    } catch (error) {
        console.error('[Memo][single-api] 主回复写表解析失败:', error);
    }
}

function onChatChanged() {
    // 新聊天打开后预热六表。已有表的聊天不会重建。
    setTimeout(ensureFreshChatSheets, 0);
    setTimeout(ensureFreshChatSheets, 150);
}

APP.eventSource.on(APP.event_types.CHAT_COMPLETION_PROMPT_READY, onPromptReady);
APP.eventSource.on(APP.event_types.CHARACTER_MESSAGE_RENDERED, onMessageRendered);
APP.eventSource.on(APP.event_types.CHAT_CHANGED, onChatChanged);

console.log('[Memo] 单API专用运行链已加载（含新聊天六表初始化与显式保存）');
