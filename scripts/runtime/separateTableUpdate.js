import {BASE, DERIVED, EDITOR, SYSTEM, USER} from '../../core/manager.js';
import { executeIncrementalUpdateFromSummary } from "./absoluteRefresh.js";
import { newPopupConfirm } from '../../components/popupConfirm.js';
import { reloadCurrentChat } from "/script.js"
import {getTablePrompt,initTableData} from "../../index.js"

let toBeExecuted = [];

const MANUAL_PATCH_GUIDE = `【手动更新记忆｜只补漏】
只检查下面“最近一轮聊天”中已经明确发生、但当前六张表可能漏记的新事实或状态变化。
- 当前表格是基线：已有同一对象优先 update，真正新增才 insert，明确因本轮剧情失去/结束才 delete。
- 不整理与本轮无关的旧人物、旧事件、旧任务、旧重复项。
- 只是再次提及或查看已有内容且没有变化时，不操作。
- 不猜测未知。没有漏记时不要为了整理而修改表格。`;

const TABLE_CLEANUP_GUIDE = `【表格整理｜只整理已有记忆】
本次只整理当前六张表中已经存在的数据。近期聊天只能帮助理解，不得作为新增记忆来源。
- 禁止补录表格中尚不存在的新人物、新物品、新任务、新事件或新状态。
- 优先 update 合并重复/冗余信息；只有确认重复、失效或错误时才 delete。
- insert 仅允许在重组当前表中已有信息且确有必要时使用，不能用于补最近剧情。
- 人物只有能确认是同一实体时才合并；同名但证据不足必须保留。
- 背包不同品质、状态或单位不要强行合并。
- 历史事件不同阶段、不同结果不要误并。
- 语义不确定时宁可保留，不整表重建，不改表头。`;

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

function getLatestConversationTurn() {
    const chat = USER.getContext()?.chat ?? [];
    if (!Array.isArray(chat) || chat.length === 0) return '';

    let assistantIndex = -1;
    for (let i = chat.length - 1; i >= 0; i--) {
        if (chat[i]?.is_user === false && String(chat[i]?.mes ?? '').trim()) {
            assistantIndex = i;
            break;
        }
    }
    if (assistantIndex < 0) return '';

    let userIndex = -1;
    for (let i = assistantIndex - 1; i >= 0; i--) {
        if (chat[i]?.is_user === true && String(chat[i]?.mes ?? '').trim()) {
            userIndex = i;
            break;
        }
        if (chat[i]?.is_user === false) break;
    }

    const parts = [];
    if (userIndex >= 0) {
        const text = handleMessages(String(chat[userIndex].mes ?? '')).trim();
        if (text) parts.push(`${chat[userIndex].name || 'user'}: ${text}`);
    }
    const assistantText = handleMessages(String(chat[assistantIndex].mes ?? '')).trim();
    if (assistantText) parts.push(`${chat[assistantIndex].name || 'assistant'}: ${assistantText}`);
    return parts.join('\n');
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

function ensureCharacterAliasColumnInSheet(sheet, referencePiece) {
    try {
        if (!sheet?.getContent) return false;
        const valueSheet = sheet.getContent(true);
        if (!Array.isArray(valueSheet) || valueSheet.length === 0) return false;
        const header = valueSheet[0];
        if (!Array.isArray(header) || header.includes('别名/称呼')) return false;
        const nameCol = header.indexOf('姓名');
        if (nameCol < 0) return false;
        const insertAt = nameCol + 1;
        const migrated = valueSheet.map((row, rowIndex) => {
            const copy = [...row];
            copy.splice(insertAt, 0, rowIndex === 0 ? '别名/称呼' : '');
            return copy;
        });
        sheet.rebuildHashSheetByValueSheet(migrated);
        sheet.source.data.note = '值得长期记忆的NPC；同一人物一行；姓名/别名/称呼共同用于识别同一实体';
        sheet.source.data.insertNode = '新增前先检查姓名/别名/身份/外貌/事件链，确认不是已有实体才插入';
        sheet.source.data.updateNode = '同一实体出现新姓名/昵称/外号/称呼时更新原行并补入别名；其他长期信息变化时更新';
        sheet.save(referencePiece, true);
        console.log('[World Memory][schema] 当前聊天人物表已兼容增加“别名/称呼”列');
        return true;
    } catch (error) {
        console.warn('[World Memory][schema] 当前聊天人物表别名列迁移失败，已跳过:', error);
        return false;
    }
}

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

        const personSheet = sheets.find(s => s?.name === '人物表');
        if (personSheet && ensureCharacterAliasColumnInSheet(personSheet, referencePiece)) changed = true;

        for (const sheetName of ['当前状态表', '角色状态表']) {
            const sheet = sheets.find(s => s?.name === sheetName);
            if (!sheet?.getContent) continue;
            const valueSheet = sheet.getContent(true);
            if (Array.isArray(valueSheet) && valueSheet.length > 2) {
                saveValueSheet(sheet, [valueSheet[0], valueSheet[valueSheet.length - 1]]);
                console.log(`[World Memory][normalize] ${sheetName} 已压缩为最新快照`);
            }
        }

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

        if (changed) console.log('[World Memory][normalize] 按表格类型的轻量整理完成');
    } catch (error) {
        console.warn('[World Memory][normalize] 整理失败，已跳过，不影响本轮写表:', error);
    }
}

export async function TableTwoStepSummary(mode) {
    if (mode !== "manual" && (USER.tableBaseSetting.isExtensionAble === false || USER.tableBaseSetting.step_by_step === false)) return;

    const {piece: todoPiece} = USER.getChatPiece();
    if (todoPiece === undefined) {
        console.log('[World Memory][auto] 未找到待填表的对话片段');
        if (mode === 'manual') EDITOR.error('未找到待填表的对话片段，请检查当前对话是否正确。');
        return false;
    }

    const todoChats = mode === 'manual' ? (getLatestConversationTurn() || todoPiece.mes) : todoPiece.mes;
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

    const popupContentHtml = `<p><b>手动更新记忆</b></p><p>只检查最近一轮 user + assistant 是否有自动记录漏掉的新信息，不整理旧记忆。</p>`;
    const confirmResult = await newPopupConfirm(
        popupContentHtml,
        "取消",
        "检查并补记",
        'stepwiseSummaryConfirm',
        "不再提示",
        "一直选是"
    );

    console.log('newPopupConfirm result for manual memory patch:', confirmResult);
    if (confirmResult === false) return false;
    return await manualSummaryChat(todoChats, confirmResult);
}

export async function manualSummaryChat(todoChats, confirmResult) {
    const { piece: referencePiece } = USER.getChatPiece();
    if (!referencePiece) {
        EDITOR.error("无法获取当前的聊天片段，操作中止。");
        return false;
    }

    const isAutoMode = confirmResult === 'dont_remind_active';
    const originText = getTablePrompt(referencePiece);
    const finalPrompt = initTableData();
    const useMainApiForStepByStep = USER.tableBaseSetting.step_by_step_use_main_api ?? true;
    const summaryInput = isAutoMode ? todoChats : `${MANUAL_PATCH_GUIDE}\n\n<最近一轮聊天>\n${todoChats}\n</最近一轮聊天>`;

    const r = await executeIncrementalUpdateFromSummary(
        summaryInput,
        originText,
        finalPrompt,
        referencePiece,
        useMainApiForStepByStep,
        USER.tableBaseSetting.bool_silent_refresh,
        isAutoMode
    );

    console.log('[World Memory] 独立填表增量更新结果:', r);
    if (r === 'success') {
        if (isAutoMode) normalizeWorldMemorySheets(referencePiece);
        await USER.saveChat();
        if (!isAutoMode) reloadCurrentChat();
        return true;
    }
    return false;
}

export async function cleanupWorldMemorySheets() {
    const { piece: referencePiece } = USER.getChatPiece();
    if (!referencePiece) {
        EDITOR.error('无法获取当前表格数据，操作中止。');
        return false;
    }

    const confirmResult = await newPopupConfirm(
        '<p><b>表格整理</b></p><p>只整理六张表中已有的重复、冗余或失效记录；不会补录最近剧情，也不会整表重建。</p>',
        '取消',
        '开始整理',
        'worldMemoryCleanupConfirm',
        '不再提示',
        '一直选是'
    );
    if (confirmResult === false) return false;

    // 与“手动更新记忆”完全共用同一套表格 schema、提示模板和 API 选择。
    // 职责差异只放在 summaryInput 的任务说明里，不额外包裹或改写表格内容。
    const originText = getTablePrompt(referencePiece);
    const finalPrompt = initTableData();
    const useMainApiForStepByStep = USER.tableBaseSetting.step_by_step_use_main_api ?? true;

    const r = await executeIncrementalUpdateFromSummary(
        TABLE_CLEANUP_GUIDE,
        originText,
        finalPrompt,
        referencePiece,
        useMainApiForStepByStep,
        USER.tableBaseSetting.bool_silent_refresh,
        false
    );

    console.log('[World Memory] 表格整理增量更新结果:', r);
    if (r === 'success') {
        await USER.saveChat();
        reloadCurrentChat();
        return true;
    }
    return false;
}
