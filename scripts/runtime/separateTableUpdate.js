import {BASE, DERIVED, EDITOR, SYSTEM, USER} from '../../core/manager.js';
import { executeIncrementalUpdateFromSummary } from "./absoluteRefresh.js";
import { newPopupConfirm } from '../../components/popupConfirm.js';
import { reloadCurrentChat } from "/script.js"
import {getTablePrompt,initTableData, undoSheets} from "../../index.js"

let toBeExecuted = [];

function InitChatForTableTwoStepSummary(chat) {
    if (chat.uid === undefined) chat.uid = SYSTEM.generateRandomString(22);
    if (chat.two_step_links === undefined) chat.two_step_links = {};
    if (chat.two_step_waiting === undefined) chat.two_step_waiting = {};
}

function getSwipeUid(chat) {
    InitChatForTableTwoStepSummary(chat);
    const swipeUid = `${chat.uid}_${chat.swipe_id}`;
    if (!(swipeUid in chat.two_step_links)) chat.two_step_links[swipeUid] = [];
    if (!(swipeUid in chat.two_step_waiting)) chat.two_step_waiting[swipeUid] = true;
    return swipeUid;
}

function checkIfChatIsExecuted(chat, targetSwipeUid) {
    const chatSwipeUid = getSwipeUid(chat);
    return chat.two_step_links[chatSwipeUid].includes(targetSwipeUid);
}

function handleMessages(string) {
    return string.replace(/<(tableEdit|think|thinking)>[\s\S]*?<\/\1>/g, '');
}

function MarkChatAsWaiting(chat, swipeUid) {
    if (!chat || !swipeUid) return;
    InitChatForTableTwoStepSummary(chat);
    chat.two_step_waiting[swipeUid] = true;
}

/**
 * 执行独立填表。
 * auto 模式由 CHARACTER_MESSAGE_RENDERED 自动触发，必须静默执行，不能等待弹窗。
 * manual 模式保留原来的确认弹窗。
 */
export async function TableTwoStepSummary(mode) {
    if (mode !== "manual" && (USER.tableBaseSetting.isExtensionAble === false || USER.tableBaseSetting.step_by_step === false)) return;

    const {piece: todoPiece} = USER.getChatPiece();
    if (todoPiece === undefined) {
        console.log('[World Memory][auto] 未找到待填表的对话片段');
        if (mode === 'manual') EDITOR.error('未找到待填表的对话片段，请检查当前对话是否正确。');
        return false;
    }

    const todoChats = todoPiece.mes;
    console.log(`[World Memory][${mode}] 待填表内容长度:`, todoChats?.length ?? 0);

    // 自动模式直接后台执行。原代码在自动触发时也等待 newPopupConfirm，
    // 会造成“只有手动点击整理才真正请求填表”的表现。
    if (mode !== 'manual') {
        try {
            const result = await manualSummaryChat(todoChats, 'dont_remind_active');
            console.log('[World Memory][auto] 自动填表结果:', result);
            return result;
        } catch (error) {
            console.error('[World Memory][auto] 自动填表异常:', error);
            return false;
        }
    }

    const popupContentHtml = `<p>累计 ${todoChats.length} 长度的文本，是否开始独立填表？</p>`;
    const confirmResult = await newPopupConfirm(
        popupContentHtml,
        "取消",
        "执行填表",
        'stepwiseSummaryConfirm',
        "不再提示",
        "一直选是"
    );

    console.log('newPopupConfirm result for stepwise summary:', confirmResult);
    if (confirmResult === false) return false;
    return await manualSummaryChat(todoChats, confirmResult);
}

/**
 * 手动/自动独立填表：沿用原插件的增量更新核心。
 */
export async function manualSummaryChat(todoChats, confirmResult) {
    const { piece: initialPiece } = USER.getChatPiece();
    if (!initialPiece) {
        EDITOR.error("无法获取当前的聊天片段，操作中止。");
        return false;
    }

    // 只有手动重做时才撤销已有表格版本。
    // 自动填表绝不能先 undo，否则会把上一轮已经正确保存的状态回滚。
    const isAutoMode = confirmResult === 'dont_remind_active';
    if (!isAutoMode && initialPiece.hash_sheets && Object.keys(initialPiece.hash_sheets).length > 0) {
        console.log('[Memory Enhancement] 手动立即填表：检测到表格中有数据，执行恢复操作...');
        try {
            await undoSheets(0);
            EDITOR.success('表格已恢复到上一版本。');
        } catch (e) {
            EDITOR.error('恢复表格失败，操作中止。', e.message, e);
            return false;
        }
    }

    const { piece: referencePiece } = USER.getChatPiece();
    if (!referencePiece) return false;

    const originText = getTablePrompt(referencePiece);
    const finalPrompt = initTableData();
    const useMainApiForStepByStep = USER.tableBaseSetting.step_by_step_use_main_api ?? true;

    const r = await executeIncrementalUpdateFromSummary(
        todoChats,
        originText,
        finalPrompt,
        referencePiece,
        useMainApiForStepByStep,
        USER.tableBaseSetting.bool_silent_refresh,
        isAutoMode
    );

    console.log('[World Memory] 独立填表增量更新结果:', r);
    if (r === 'success') {
        await USER.saveChat();
        // 自动模式不整页 reload，避免每轮生成后强制刷新页面；手动模式保留原行为。
        if (!isAutoMode) reloadCurrentChat();
        return true;
    }
    return false;
}
