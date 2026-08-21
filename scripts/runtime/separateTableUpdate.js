import { BASE, EDITOR, USER } from '../../core/manager.js';
import { newPopupConfirm } from '../../components/popupConfirm.js';
import { reloadCurrentChat } from '/script.js';
import { getTableEditTag, getTablePrompt, undoSheets } from '../../index.js';
import { handleCustomAPIRequest, handleMainAPIRequest } from '../settings/standaloneAPI.js';
import { updateSystemMessageTableStatus } from '../renderer/tablePushToChat.js';
import { repairMissingColumnsBeforeCleanup } from './tableStructureRepair.js?v=memo77';
import { executeMemoTableEdit } from './safeTableExecutor.js?v=memo77';
import JSON5 from '../../utils/json5.min.mjs';

const INDEPENDENT_OPERATION_RULES = `# Memo独立记录操作协议
固定标准表索引：0当前状态 / 1角色状态 / 2背包 / 3当前任务与约定 / 4人物主表 / 5人物发展表 / 6历史事件。
只能使用：
insertRow(tableIndex:number,data:{[colIndex:number]:string|number})
updateRow(tableIndex:number,rowIndex:number,data:{[colIndex:number]:string|number})
deleteRow(tableIndex:number,rowIndex:number)
已有对象优先update，真正新增才insert，明确结束/消失按表规则delete；不要修改表头。
人物主表与人物发展表通过姓名关联；年龄与最后确认时间必须分别维护。
没有任何明确变化时输出<tableEdit><!-- NO_CHANGE --></tableEdit>。
最终只能输出一个完整<tableEdit>...</tableEdit>，不得输出剧情、JSON、解释或Markdown。`;

function stripMachine(text) {
    return String(text ?? '')
        .replace(/<tableEdit>[\s\S]*?<\/tableEdit>/gi, '')
        .replace(/<(think|thinking)>[\s\S]*?<\/\1>/gi, '')
        .trim();
}

function buildRecentContext() {
    const chat = Array.isArray(USER.getContext?.()?.chat) ? USER.getContext().chat : [];
    const layers = Math.max(0, Number(USER.tableBaseSetting.separateReadContextLayers) || 1);
    if (!layers) return '';
    const current = USER.getChatPiece?.()?.piece;
    const candidates = chat.filter(item => item && item !== current && item.is_user === false);
    return candidates.slice(-layers).map(item => `${item.name || 'assistant'}: ${stripMachine(item.mes)}`).join('\n');
}

async function readLorebook() {
    if (!USER.tableBaseSetting.separateReadLorebook || !window.TavernHelper) return '';
    try {
        const books = await window.TavernHelper.getCharLorebooks({ type:'all' });
        const names = [books?.primary, ...(Array.isArray(books?.additional) ? books.additional : [])].filter(Boolean);
        const chunks = [];
        for (const name of names) {
            const entries = await window.TavernHelper.getLorebookEntries(name);
            if (Array.isArray(entries)) chunks.push(...entries.map(entry => String(entry?.content ?? '')).filter(Boolean));
        }
        return chunks.join('\n');
    } catch (error) {
        console.warn('[Memo][independent] 世界书读取失败，继续使用现有表格与聊天上下文', error);
        return '';
    }
}

function parsePromptTemplate() {
    const raw = String(USER.tableBaseSetting.step_by_step_user_prompt || '').trim();
    try {
        const parsed = JSON5.parse(raw);
        if (!Array.isArray(parsed) || !parsed.length) throw new Error('提示词不是非空消息数组');
        return parsed;
    } catch (error) {
        throw new Error(`独立填表提示词格式错误：${error?.message || error}`);
    }
}

async function buildIndependentMessages(todoChats, originText) {
    const contextChats = buildRecentContext();
    const lorebook = await readLorebook();
    const template = parsePromptTemplate();
    const replace = value => String(value ?? '')
        .replace(/(?<!\\)\$0/g, () => originText)
        .replace(/(?<!\\)\$1/g, () => contextChats)
        .replace(/(?<!\\)\$2/g, () => stripMachine(todoChats))
        .replace(/(?<!\\)\$3/g, () => INDEPENDENT_OPERATION_RULES)
        .replace(/(?<!\\)\$4/g, () => lorebook);
    return template.map(message => ({ ...message, content: replace(message?.content) }));
}

async function runIndependentApi(todoChats, referencePiece, isSilentMode) {
    const originText = getTablePrompt(referencePiece);
    const messages = await buildIndependentMessages(todoChats, originText);
    const useMain = USER.tableBaseSetting.step_by_step_use_main_api ?? true;

    let rawContent;
    try {
        rawContent = useMain
            ? await handleMainAPIRequest(messages, null, isSilentMode)
            : await handleCustomAPIRequest(messages, null, true, isSilentMode);
    } catch (error) {
        console.error('[Memo][independent] API请求异常', error);
        EDITOR.warning(`独立记录API请求失败：${error?.message || error}`);
        return false;
    }

    if (rawContent === 'suspended') return false;
    if (typeof rawContent !== 'string' || !rawContent.trim() || /^错误[:：]/.test(rawContent.trim())) {
        console.error('[Memo][independent] API返回无效:', rawContent);
        EDITOR.warning('独立记录失败：API返回为空或错误内容，原表未修改。');
        return false;
    }

    const { matches } = getTableEditTag(rawContent);
    if (!Array.isArray(matches) || !matches.length) {
        console.error('[Memo][independent] 模型未返回tableEdit:', rawContent);
        EDITOR.warning('独立记录失败：模型没有返回<tableEdit>，原表未修改。');
        return false;
    }

    const result = executeMemoTableEdit(matches, referencePiece);
    if (!result.ok) {
        console.error('[Memo][independent] tableEdit校验/执行失败:', result.error, matches);
        EDITOR.warning(`独立记录失败：${result.error}。原表未执行错误操作。`);
        return false;
    }

    await USER.saveChat();
    BASE.refreshContextView();
    updateSystemMessageTableStatus();
    console.log(`[Memo][independent] 严格记录完成：${result.noChange ? 'NO_CHANGE' : `${result.count}项操作`}`);
    return true;
}

/** auto：独立记录开关开启后，正文完成时额外调用1次记录API。 manual：用户手动触发。 */
export async function TableTwoStepSummary(mode = 'manual') {
    if (USER.tableBaseSetting.isExtensionAble === false) return false;
    if (!['auto','manual'].includes(mode)) {
        console.warn(`[Memo][independent] 已拒绝旧模式 ${mode}；一次API不允许fallback补记。`);
        return false;
    }
    if (mode === 'auto' && USER.tableBaseSetting.step_by_step === false) return false;

    const { piece: todoPiece } = USER.getChatPiece();
    if (!todoPiece) {
        if (mode === 'manual') EDITOR.error('未找到待填表的对话片段，请至少生成一条角色回复。');
        return false;
    }
    const todoChats = String(todoPiece.mes ?? '');

    if (mode === 'manual') {
        const popupContentHtml = `<p>累计 ${todoChats.length} 长度的文本，是否开始独立填表？</p>`;
        const confirmResult = await newPopupConfirm(popupContentHtml, '取消', '执行填表', 'stepwiseSummaryConfirm', '不再提示', '一直选是');
        if (confirmResult === false) return false;
        return await manualSummaryChat(todoChats, confirmResult);
    }

    return await manualSummaryChat(todoChats, 'dont_remind_active');
}

export async function manualSummaryChat(todoChats, confirmResult) {
    const { piece: initialPiece } = USER.getChatPiece();
    if (!initialPiece) return false;
    const isAutoMode = confirmResult === 'dont_remind_active';

    if (!isAutoMode && initialPiece.hash_sheets && Object.keys(initialPiece.hash_sheets).length > 0) {
        try {
            await undoSheets(0);
            EDITOR.success('表格已恢复到上一版本。');
        } catch (error) {
            EDITOR.error('恢复表格失败，操作中止。', error?.message || String(error), error);
            return false;
        }
    }

    repairMissingColumnsBeforeCleanup({ notify:false });
    const { piece: referencePiece } = USER.getChatPiece();
    if (!referencePiece) return false;

    const ok = await runIndependentApi(todoChats, referencePiece, isAutoMode);
    if (ok && !isAutoMode) reloadCurrentChat();
    return ok;
}
