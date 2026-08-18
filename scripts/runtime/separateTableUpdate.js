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
 * 对已经成功写入的六表做“只处理确定规则”的轻量整理。
 * 设计原则：
 * 1. 不改增量解析/执行核心；
 * 2. 整理失败只记日志，不影响已完成的写表；
 * 3. 不对人物/历史做语义猜测或强行合并，避免误删有效信息。
 */
function normalizeWorldMemorySheets(referencePiece) {
    try {
        const sheets = BASE.getChatSheets?.() ?? [];
        if (!Array.isArray(sheets) || sheets.length === 0) return;

        let changed = false;

        const saveValueSheet = (sheet, valueSheet) => {
            sheet.rebuildHashSheetByValueSheet(valueSheet);
            sheet.save(referencePiece, true);
            changed = true;
        };

        // 当前状态表 / 角色状态表：只允许一条当前快照，异常多行时保留最新一行。
        for (const sheetName of ['当前状态表', '角色状态表']) {
            const sheet = sheets.find(s => s?.name === sheetName);
            if (!sheet?.getContent) continue;
            const valueSheet = sheet.getContent(true);
            if (Array.isArray(valueSheet) && valueSheet.length > 2) {
                saveValueSheet(sheet, [valueSheet[0], valueSheet[valueSheet.length - 1]]);
                console.log(`[World Memory][normalize] ${sheetName} 多行快照已压缩为最新一行`);
            }
        }

        // 背包：同名物品只保留最新一条。数量/状态应该由 AI update；若误 insert，代码层兜底去重。
        const bagSheet = sheets.find(s => s?.name === '背包表');
        if (bagSheet?.getContent) {
            const valueSheet = bagSheet.getContent(true);
            if (Array.isArray(valueSheet) && valueSheet.length > 2) {
                const header = valueSheet[0];
                const itemNameCol = header.indexOf('物品名');
                if (itemNameCol >= 0) {
                    const seen = new Set();
                    const keptReverse = [];
                    for (let i = valueSheet.length - 1; i >= 1; i--) {
                        const row = valueSheet[i];
                        const key = String(row?.[itemNameCol] ?? '').trim().toLowerCase();
                        // 空名称不主动删除，避免误伤异常但可能有用的数据。
                        if (!key || !seen.has(key)) {
                            keptReverse.push(row);
                            if (key) seen.add(key);
                        }
                    }
                    const cleaned = [header, ...keptReverse.reverse()];
                    if (cleaned.length !== valueSheet.length) {
                        saveValueSheet(bagSheet, cleaned);
                        console.log(`[World Memory][normalize] 背包重复物品已去重: ${valueSheet.length - cleaned.length} 行`);
                    }
                }
            }
        }

        // 当前任务与约定：完成/失败/取消/失效后不再属于“当前”，自动移出。
        const taskSheet = sheets.find(s => s?.name === '当前任务与约定表');
        if (taskSheet?.getContent) {
            const valueSheet = taskSheet.getContent(true);
            if (Array.isArray(valueSheet) && valueSheet.length > 1) {
                const header = valueSheet[0];
                const statusCol = header.indexOf('当前状态');
                if (statusCol >= 0) {
                    const endedStatus = new Set(['完成', '已完成', '失败', '已失败', '取消', '已取消', '失效', '已失效', '结束', '已结束']);
                    const cleaned = [header, ...valueSheet.slice(1).filter(row => {
                        const status = String(row?.[statusCol] ?? '').trim();
                        return !endedStatus.has(status);
                    })];
                    if (cleaned.length !== valueSheet.length) {
                        saveValueSheet(taskSheet, cleaned);
                        console.log(`[World Memory][normalize] 已结束任务已移出当前任务表: ${valueSheet.length - cleaned.length} 行`);
                    }
                }
            }
        }

        if (changed) console.log('[World Memory][normalize] 轻量整理完成');
    } catch (error) {
        // 整理是兜底层，绝不能因为这里失败而破坏已经跑通的自动填表。
        console.warn('[World Memory][normalize] 轻量整理失败，已跳过，不影响本轮写表:', error);
    }
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
        // 先让核心链完成，再执行可失败、可跳过的轻量整理。
        normalizeWorldMemorySheets(referencePiece);
        await USER.saveChat();
        // 自动模式不整页 reload，避免每轮生成后强制刷新页面；手动模式保留原行为。
        if (!isAutoMode) reloadCurrentChat();
        return true;
    }
    return false;
}
