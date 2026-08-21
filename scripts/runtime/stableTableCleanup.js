import { BASE, EDITOR, USER } from '../../core/manager.js';
import { executeTableEditActions, getTableEditTag, getTablePromptByPiece } from '../../index.js';
import { handleCustomAPIRequest, handleMainAPIRequest, estimateTokenCount } from '../settings/standaloneAPI.js';
import { updateSystemMessageTableStatus } from '../renderer/tablePushToChat.js';
import { repairMissingColumnsBeforeCleanup } from './tableStructureRepair.js';

const INSTALL_FLAG = '__memoStableTableCleanupInstalled';
let running = false;

const SYSTEM_PROMPT = `你是Memo世界状态表格整理器。只整理现有六张表，不写剧情，不输出完整JSON表格。
你的最终回复必须且只能包含一个完整<tableEdit>...</tableEdit>。
表头结构由代码维护，你只能通过insertRow/updateRow/deleteRow整理数据行，不得创建、删除、改名或重排表头。

整理原则：
- 0当前状态表：快照型，只保留最新有效一行；重复旧快照删除。
- 1角色状态表：只保存玩家本人最新状态，最多一行；NPC不得进入此表。
- 2背包表：维护当前实际持有库存；同一物品重复行合并，数量/状态以较新明确事实为准，已完全失去的物品删除。
- 3当前任务与约定表：只保留尚未结束事项；已完成/失败/取消/失效的行删除，重大结果可留在历史表。
- 4人物表：NPC专属，同一NPC只保留一行。合并重复人物时综合姓名、别名/称呼、身份、外貌、关系和事件链判断，不得只因同名就强行合并。保存最后有效发展锚点：修为、主要能力、身份/所属、当前地点、年龄或最后确认时间、当前重要状态、主要目标/事项、与玩家关系。新明确事实覆盖旧锚点；未知留空，不得编造。
- 5历史事件表：只保留真正影响未来推演的重要既成节点；突破/失败、势力变化、婚姻或重要亲属变化、重伤残疾/寿元重大损耗、重大机缘、战争/宗门覆灭导致处境改变、死亡可保留；普通修炼、日常生活、重复过程和微小财富变化删除或压缩。
- 人物最新状态与历史冲突时，以时间更晚且已明确发生的事实为准。
- 写任何操作前先检查现有行；能update/delete解决就不要重复insert。
- 没有任何需要整理的变化时输出<tableEdit><!-- NO_CHANGE --></tableEdit>。
- 函数调用必须放在同一个HTML注释中，例如<tableEdit><!-- updateRow(...); deleteRow(...); --></tableEdit>。`;

function escapeHtml(text) {
    return String(text ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

async function buildRecentChat() {
    const chat = Array.isArray(USER.getContext()?.chat) ? USER.getContext().chat : [];
    const ignoreUser = USER.tableBaseSetting.ignore_user_sent === true;
    const filtered = ignoreUser ? chat.filter(item => item?.is_user === false) : chat;
    const maxRows = Math.max(1, Number(USER.tableBaseSetting.clear_up_stairs) || 9);
    const useTokenLimit = USER.tableBaseSetting.use_token_limit === true;
    const tokenLimit = Math.max(0, Number(USER.tableBaseSetting.rebuild_token_limit_value) || 0);
    const collected = [];
    let totalTokens = 0;

    for (let i = filtered.length - 1; i >= 0 && collected.length < maxRows; i--) {
        const item = filtered[i];
        const line = `${item?.name || (item?.is_user ? 'user' : 'assistant')}: ${String(item?.mes ?? '')}`
            .replace(/<tableEdit>[\s\S]*?<\/tableEdit>/gi, '')
            .trim();
        if (!line) continue;

        if (useTokenLimit && tokenLimit > 0) {
            const tokens = await estimateTokenCount(line);
            if (collected.length > 0 && totalTokens + tokens > tokenLimit) break;
            totalTokens += tokens;
        }
        collected.push(line);
    }
    return collected.reverse().join('\n');
}

async function runStableCleanup() {
    if (running) return EDITOR.warning('表格整理正在进行中');
    running = true;
    try {
        repairMissingColumnsBeforeCleanup();

        const reference = BASE.getLastSheetsPiece();
        const piece = reference?.piece;
        if (!piece?.hash_sheets) {
            EDITOR.error('表格整理失败：没有找到可整理的表格记录');
            return;
        }

        const tableText = getTablePromptByPiece(piece);
        if (!String(tableText || '').trim()) {
            EDITOR.error('表格整理失败：当前表格内容无法读取');
            return;
        }
        const recentChat = await buildRecentChat();
        const userPrompt = `<当前六表>\n${tableText}\n</当前六表>\n<最近聊天>\n${recentChat}\n</最近聊天>\n\n请逐表检查重复、过期、错位和应合并的数据，并按现有rowIndex生成必要的tableEdit操作。不要为了“更完整”编造未知信息。`;

        const useMainApi = USER.tableBaseSetting.use_main_api !== false;
        let rawContent;
        try {
            rawContent = useMainApi
                ? await handleMainAPIRequest(SYSTEM_PROMPT, userPrompt)
                : await handleCustomAPIRequest(SYSTEM_PROMPT, userPrompt);
        } catch (error) {
            EDITOR.error('表格整理API请求失败', error?.message || String(error), error);
            return;
        }

        if (rawContent === 'suspended') {
            EDITOR.info('表格整理已取消');
            return;
        }
        if (typeof rawContent !== 'string' || !rawContent.trim()) {
            EDITOR.error('表格整理失败：API返回为空，原表未修改');
            return;
        }

        const { matches } = getTableEditTag(rawContent);
        if (!matches || matches.length === 0) {
            const tail = rawContent.replace(/\s+/g, ' ').trim().slice(-260);
            console.warn('[Memo][table-cleanup] AI未返回tableEdit:', rawContent);
            EDITOR.error(`表格整理失败：模型未返回tableEdit，原表未修改｜末尾：${tail}`);
            return;
        }

        const joined = matches.join('\n');
        if (/NO_CHANGE/i.test(joined) && !/(?:insertRow|updateRow|deleteRow)\s*\(/.test(joined)) {
            EDITOR.success('表格检查完成：当前无需整理');
            return;
        }

        if (USER.tableBaseSetting.bool_silent_refresh !== true) {
            const preview = `<div style="max-height:55vh;overflow:auto"><p>AI准备执行以下表格整理操作：</p><pre style="white-space:pre-wrap">${escapeHtml(joined)}</pre><p>确认后才会修改当前表格。</p></div>`;
            const confirmed = await EDITOR.callGenericPopup(preview, EDITOR.POPUP_TYPE.CONFIRM, '表格整理确认', { okButton: '执行', cancelButton: '取消' });
            if (!confirmed) {
                EDITOR.info('表格整理已取消，原表未修改');
                return;
            }
        }

        const ok = executeTableEditActions(matches, piece);
        if (!ok) {
            EDITOR.error('表格整理执行失败，未能保存操作');
            return;
        }
        USER.saveChat();
        BASE.refreshContextView();
        updateSystemMessageTableStatus();
        EDITOR.success('表格整理完成');
    } catch (error) {
        console.error('[Memo][table-cleanup] 整理失败:', error);
        EDITOR.error('表格整理失败', error?.message || String(error), error);
    } finally {
        running = false;
    }
}

function install() {
    if (window[INSTALL_FLAG]) return;
    window[INSTALL_FLAG] = true;
    document.addEventListener('click', event => {
        const button = event.target?.closest?.('#table_clear_up');
        if (!button) return;
        // Capture phase intercepts the legacy JSON rebuild handler before it can run.
        event.preventDefault();
        event.stopImmediatePropagation();
        runStableCleanup();
    }, true);
    console.log('[Memo] 稳定tableEdit表格整理已接管主整理按钮');
}

install();

export { runStableCleanup };
