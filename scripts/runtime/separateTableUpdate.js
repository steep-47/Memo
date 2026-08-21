import {BASE, DERIVED, EDITOR, SYSTEM, USER} from '../../core/manager.js';
import { executeIncrementalUpdateFromSummary } from "./absoluteRefresh.js";
import { repairMissingColumnsBeforeCleanup } from "./tableStructureRepair.js";
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

function normalizeKey(value) {
    return String(value ?? '').trim().toLowerCase();
}

function parseQuantity(value) {
    const text = String(value ?? '').trim();
    const match = text.match(/^\s*(\d+(?:\.\d+)?)\s*([^\d\s].*?)?\s*$/);
    if (!match) return null;
    const number = Number(match[1]);
    if (!Number.isFinite(number)) return null;
    return { number, unit: String(match[2] ?? '').trim() };
}

function formatQuantity(number, unit) {
    const safeNumber = Number.isInteger(number) ? String(number) : String(Number(number.toFixed(4)));
    return `${safeNumber}${unit || ''}`;
}

/**
 * 对已经成功写入的六表做按“表格语义”区分的轻量整理。
 * 表结构统一由 tableStructureRepair 维护；这里不再私自增删人物表列。
 * 只处理可确定的行级规则；语义不确定时宁可保留，避免误删。
 */
function normalizeWorldMemorySheets(referencePiece) {
    try {
        // 手动/分步更新可能绕过普通聊天提示事件，因此在行级整理前也静默校验一次标准结构。
        repairMissingColumnsBeforeCleanup({ notify: false });

        const sheets = BASE.getChatSheets?.() ?? [];
        if (!Array.isArray(sheets) || sheets.length === 0) return;

        let changed = false;
        const saveValueSheet = (sheet, valueSheet) => {
            // 六张标准表已安装结构guard；整表压缩/合并也不能改坏标准表头。
            sheet.rebuildHashSheetByValueSheet(valueSheet);
            sheet.save(referencePiece, true);
            changed = true;
        };

        // 1) 快照型：当前状态 / 角色状态，只保留最新一行。
        for (const sheetName of ['当前状态表', '角色状态表']) {
            const sheet = sheets.find(s => s?.name === sheetName);
            if (!sheet?.getContent) continue;
            const valueSheet = sheet.getContent(true);
            if (Array.isArray(valueSheet) && valueSheet.length > 2) {
                saveValueSheet(sheet, [valueSheet[0], valueSheet[valueSheet.length - 1]]);
                console.log(`[World Memory][normalize] ${sheetName} 已压缩为最新快照`);
            }
        }

        // 2) 库存型：背包按“物品名+类型+状态/品质”归组。
        // 数量能解析且单位一致时相加；不同品质/状态/单位不强制合并。
        const bagSheet = sheets.find(s => s?.name === '背包表');
        if (bagSheet?.getContent) {
            const valueSheet = bagSheet.getContent(true);
            if (Array.isArray(valueSheet) && valueSheet.length > 2) {
                const header = valueSheet[0];
                const nameCol = header.indexOf('物品名');
                const typeCol = header.indexOf('类型');
                const quantityCol = header.indexOf('数量');
                const stateCol = header.indexOf('状态/品质');
                const remarkCol = header.indexOf('备注');

                if (nameCol >= 0 && quantityCol >= 0) {
                    const groups = new Map();
                    const passthrough = [];

                    for (const row of valueSheet.slice(1)) {
                        const name = normalizeKey(row?.[nameCol]);
                        if (!name) {
                            passthrough.push(row);
                            continue;
                        }
                        const type = typeCol >= 0 ? normalizeKey(row?.[typeCol]) : '';
                        const state = stateCol >= 0 ? normalizeKey(row?.[stateCol]) : '';
                        const key = `${name}||${type}||${state}`;
                        if (!groups.has(key)) groups.set(key, []);
                        groups.get(key).push(row);
                    }

                    const mergedRows = [];
                    for (const rows of groups.values()) {
                        if (rows.length === 1) {
                            mergedRows.push(rows[0]);
                            continue;
                        }

                        const parsed = rows.map(row => parseQuantity(row?.[quantityCol]));
                        const allParsable = parsed.every(Boolean);
                        const unit = allParsable ? parsed[0].unit : null;
                        const sameUnit = allParsable && parsed.every(q => q.unit === unit);

                        if (!sameUnit) {
                            mergedRows.push(...rows);
                            continue;
                        }

                        const merged = [...rows[0]];
                        const total = parsed.reduce((sum, q) => sum + q.number, 0);
                        merged[quantityCol] = formatQuantity(total, unit);

                        if (remarkCol >= 0) {
                            const remarks = [...new Set(rows
                                .map(row => String(row?.[remarkCol] ?? '').trim())
                                .filter(Boolean))];
                            merged[remarkCol] = remarks.join(' / ');
                        }
                        mergedRows.push(merged);
                    }

                    const cleaned = [header, ...mergedRows, ...passthrough];
                    if (cleaned.length !== valueSheet.length || JSON.stringify(cleaned) !== JSON.stringify(valueSheet)) {
                        saveValueSheet(bagSheet, cleaned);
                        console.log('[World Memory][normalize] 背包同类库存已按数量合并');
                    }
                }
            }
        }

        // 3) 生命周期型：当前任务与约定，只保留尚未结束事项。
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
                        console.log(`[World Memory][normalize] 已结束任务已移出: ${valueSheet.length - cleaned.length} 行`);
                    }
                }
            }
        }

        // 4) 实体档案型：人物是否同一实体需要语义判断。
        // 代码层只保护标准14列和已有锚点；同名或不同称呼的合并由AI依据身份、外貌、关系、事件链判断。

        // 5) 事件归档型：历史事件不在代码层按文本相似度强制合并。
        // 是否属于同一事件链需要语义判断，交给提示词控制“优先 update、减少流水账”。

        if (changed) console.log('[World Memory][normalize] 按表格类型的轻量整理完成');
    } catch (error) {
        console.warn('[World Memory][normalize] 整理失败，已跳过，不影响本轮写表:', error);
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

    // 这条链不会经过普通聊天提示事件，必须在读取表格提示前自行统一标准结构。
    repairMissingColumnsBeforeCleanup({ notify: false });

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
        normalizeWorldMemorySheets(referencePiece);
        await USER.saveChat();
        if (!isAutoMode) reloadCurrentChat();
        return true;
    }
    return false;
}
