import { BASE, EDITOR, USER } from '../../core/manager.js';
import { getTablePrompt, initTableData } from '../../index.js';
import { executeIncrementalUpdateFromSummary } from './absoluteRefresh.js';

const MANUAL_UPDATE_PROMPT = JSON.stringify([
    {
        role: 'system',
        content: `你是“手动更新记忆”助手。你的唯一职责是补记最近聊天中已经明确发生、但当前六张表可能漏记的新事实或状态变化。\n\n严格边界：\n1. 以<待补记聊天>为本次检查对象，<近期上下文>只用于消歧。\n2. 当前表格是基线：已有同一对象优先 update，真正新增才 insert，明确因本轮剧情失去/结束才 delete。\n3. 禁止借本次操作整理旧表：不要扫描或删除与本轮聊天无关的旧重复行、旧事件、旧人物、旧任务。\n4. 禁止为了“更整洁”改写没有发生事实变化的记录。\n5. 只是查看、复述、再次提及已有事实且没有变化时不操作。\n6. 不猜测未知，不把推测写入表格。\n7. 只输出一个 <tableEdit>...</tableEdit>；没有漏记或变化时输出 <tableEdit><!-- NO_CHANGE --></tableEdit>。`
    },
    {
        role: 'user',
        content: `<待补记聊天>\n$2\n</待补记聊天>\n\n<近期上下文_仅用于消歧>\n$1\n</近期上下文_仅用于消歧>\n\n<当前表格>\n$0\n</当前表格>\n\n<表格操作协议>\n$3\n</表格操作协议>\n\n请只补记“待补记聊天”造成的新事实或状态变化，不要整理历史旧数据。`
    }
]);

const TABLE_CLEANUP_PROMPT = JSON.stringify([
    {
        role: 'system',
        content: `你是“表格整理”助手。你的唯一职责是整理当前表格里已经存在的旧记忆，使其更一致、更少重复，同时尽量无损。\n\n严格边界：\n1. 只允许依据<当前表格>中已经存在的信息做整理。聊天记录不是本次数据来源。\n2. 禁止补录任何“表格中尚不存在、只是最近聊天提到”的新人物、新物品、新任务、新事件或新状态。\n3. 采用增量操作，不重建整张表；优先 update，其次 delete。\n4. insert 仅允许用于合并/重组当前表中已经存在的信息且确有必要时使用，绝不能用于补记聊天新事实。\n5. 语义不确定时宁可保留，禁止因为文字相似就强行合并。\n6. 不改变六张表结构，不修改表头，不猜测未知。\n\n按表处理：\n- 0 当前状态：若有重复快照，只保留最新有效状态；不要凭空生成新状态。\n- 1 角色状态：只保留玩家本人一致的当前状态；重复行可合并，冲突信息不确定时保留较新且明确的一项。\n- 2 背包：同一物品且类型/品质/状态一致时可合并；数量只有在单位一致且能确定时才合并；不同状态或不同品质不要强并。\n- 3 当前任务与约定：已明确完成/失败/取消/失效的旧行可删除；同一事项重复记录可合并。\n- 4 人物：只有姓名/别名/身份/关系/事件链足以确认是同一实体时才合并；同名但无法确认时必须保留。\n- 5 历史事件：只删除明确重复、明显错误或属于同一事件的重复记录；不同阶段、不同结果的事件不要误并。\n\n只输出一个 <tableEdit>...</tableEdit>；无需整理时输出 <tableEdit><!-- NO_CHANGE --></tableEdit>。`
    },
    {
        role: 'user',
        content: `<当前表格>\n$0\n</当前表格>\n\n<表格操作协议>\n$3\n</表格操作协议>\n\n只整理这些已经存在的表格内容。不要读取或补录最近聊天中的新剧情。`
    }
]);

let running = false;

async function confirmAction(message, okButton) {
    const popup = new EDITOR.Popup(
        `<div style="line-height:1.6">${message}</div>`,
        EDITOR.POPUP_TYPE.CONFIRM,
        '',
        { okButton, cancelButton: '取消' }
    );
    await popup.show();
    return !!popup.result;
}

function snapshotEnabledSheets() {
    try {
        return JSON.stringify(
            (BASE.getChatSheets?.() ?? [])
                .filter(sheet => sheet?.enable)
                .map(sheet => ({
                    uid: sheet.uid,
                    name: sheet.name,
                    content: sheet.getContent?.(true) ?? null,
                }))
        );
    } catch (error) {
        console.warn('[Memo][maintenance] 无法生成表格快照:', error);
        return null;
    }
}

async function runIncrementalWithPrompt({ prompt, summaryChats, useMainAPI, purpose }) {
    if (running) {
        EDITOR.warning('已有记忆维护操作正在执行，请勿重复触发。');
        return false;
    }

    const { piece: referencePiece } = USER.getChatPiece() || {};
    if (!referencePiece) {
        EDITOR.error('未找到当前聊天片段，无法执行记忆维护。');
        return false;
    }

    running = true;
    const previousPrompt = USER.tableBaseSetting.step_by_step_user_prompt;
    const previousStepByStep = USER.tableBaseSetting.step_by_step;
    const previousSuccess = EDITOR.success;
    const beforeSnapshot = snapshotEnabledSheets();

    try {
        // 维护操作使用专属提示词；执行期间关闭自动 step_by_step 入口，避免并发读取临时提示词。
        USER.tableBaseSetting.step_by_step = false;
        USER.tableBaseSetting.step_by_step_user_prompt = prompt;

        // 公共增量执行器固定会提示“独立填表完成”，即使响应只是 NO_CHANGE。
        // 维护链先抑制这一个固定提示，结束后用前后快照确认是否真的改表。
        EDITOR.success = (message, ...args) => {
            const text = String(message ?? '').replace(/[！!]+$/g, '').trim();
            if (text === '独立填表完成') return;
            return previousSuccess.call(EDITOR, message, ...args);
        };

        const originTableText = getTablePrompt(referencePiece);
        const finalPrompt = initTableData();

        console.log(`[Memo][${purpose}] 开始执行增量维护`);
        const result = await executeIncrementalUpdateFromSummary(
            summaryChats,
            originTableText,
            finalPrompt,
            referencePiece,
            useMainAPI,
            USER.tableBaseSetting.bool_silent_refresh,
            false
        );

        if (result !== 'success') return false;

        await USER.saveChat();
        BASE.refreshContextView();

        const afterSnapshot = snapshotEnabledSheets();
        const changed = beforeSnapshot !== null && afterSnapshot !== null
            ? beforeSnapshot !== afterSnapshot
            : true;

        if (changed) {
            if (purpose === '手动更新记忆') {
                EDITOR.info('手动更新记忆完成！', '', 1500);
            } else {
                EDITOR.info('表格整理完成！', '', 1500);
            }
            console.log(`[Memo][${purpose}] 已确认表格发生实际变化`);
        } else {
            EDITOR.info(`${purpose}：没有需要修改的内容。`, '', 1500);
            console.log(`[Memo][${purpose}] NO_CHANGE / 无实际表格变化`);
        }
        return true;
    } catch (error) {
        console.error(`[Memo][${purpose}] 执行失败:`, error);
        EDITOR.error(`${purpose}失败`, error.message, error);
        return false;
    } finally {
        EDITOR.success = previousSuccess;
        USER.tableBaseSetting.step_by_step_user_prompt = previousPrompt;
        USER.tableBaseSetting.step_by_step = previousStepByStep;
        running = false;
    }
}

async function runManualMemoryUpdate() {
    const { piece } = USER.getChatPiece() || {};
    const latestMessage = String(piece?.mes ?? '')
        .replace(/<tableEdit>[\s\S]*?<\/tableEdit>/gi, '')
        .trim();

    if (!latestMessage) {
        EDITOR.info('当前没有可用于补记的最近聊天内容。');
        return;
    }

    const confirmed = await confirmAction(
        '<b>手动更新记忆</b><br>只检查最近一轮聊天中漏记的新信息或状态变化。<br><span style="opacity:.75">不会整理旧人物、旧事件或历史重复项。</span>',
        '检查并补记'
    );
    if (!confirmed) return;

    await runIncrementalWithPrompt({
        prompt: MANUAL_UPDATE_PROMPT,
        summaryChats: latestMessage,
        useMainAPI: USER.tableBaseSetting.step_by_step_use_main_api ?? true,
        purpose: '手动更新记忆'
    });
}

async function runTableCleanup() {
    const confirmed = await confirmAction(
        '<b>表格整理</b><br>只整理当前六张表中已经存在的重复、失效或可合并旧记录。<br><span style="opacity:.75">不会从最近聊天补录新剧情，也不会整表重建。</span>',
        '开始整理'
    );
    if (!confirmed) return;

    await runIncrementalWithPrompt({
        prompt: TABLE_CLEANUP_PROMPT,
        summaryChats: '',
        useMainAPI: USER.tableBaseSetting.use_main_api ?? true,
        purpose: '表格整理'
    });
}

function interceptMaintenanceButtons(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const manualButton = target.closest('#trigger_step_by_step_button');
    const cleanupButton = target.closest('#table_clear_up');
    if (!manualButton && !cleanupButton) return;

    // 捕获阶段阻止原作者旧处理器，避免手动补记继续走 undoSheets，
    // 也避免表格整理继续进入 rebuildTableActions 的整表覆盖链。
    event.preventDefault();
    event.stopImmediatePropagation();

    if (manualButton) {
        void runManualMemoryUpdate();
    } else {
        void runTableCleanup();
    }
}

document.addEventListener('click', interceptMaintenanceButtons, true);

console.log('[Memo] memory maintenance roles loaded: manual update = recent-memory patch, cleanup = existing-table maintenance');
