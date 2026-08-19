import { APP, USER } from '../../core/manager.js';

const PREF_KEY = 'independent_record_api_enabled';
const STRONG_SINGLE_API_TEMPLATE = `# Memo 本轮任务
你必须依次完成两个阶段：
1. 正常生成剧情/回答正文。
2. 正文结束后检查六张表，并用且仅用一个完整 <tableEdit>...</tableEdit> 作为本轮回复最后内容。

# 硬性结束协议
- 正文结束不代表回复完成；只有输出 </tableEdit> 才代表本轮真正完成。
- 有表格变化：在 <tableEdit> 中输出全部必要的 insertRow / updateRow / deleteRow。
- 没有任何需要记录的变化：仍必须输出 <tableEdit><!-- NO_CHANGE --></tableEdit>。
- tableEdit 必须真实出现在最终回复文本中，不能只在思考中处理，不能用自然语言替代。

# 世界状态记忆表
## 0当前状态 / 1角色状态 / 2背包 / 3当前任务与约定 / 4人物 / 5历史事件
{{tableData}}

# 可用操作
insertRow(tableIndex:number,data:{[colIndex:number]:string|number})
updateRow(tableIndex:number,rowIndex:number,data:{[colIndex:number]:string|number})
deleteRow(tableIndex:number,rowIndex:number)

# 维护规则
- 按0→1→2→3→4→5逐表检查；已有同一对象优先 update，禁止重复 insert。
- 背包只在实际获得、失去、消耗或数量/状态变化时修改；只是查看、提及或持有既有物品不得重复 insert。一次性物品使用后应减少数量或删除。
- 不猜测未知；未知信息留空。

# 最终检查
完成正文后立即执行表格检查。最终回复必须以一个完整 </tableEdit> 结束；若无变化就输出 <tableEdit><!-- NO_CHANGE --></tableEdit>。`;

function independentEnabled() {
    return USER?.getSettings?.()?.muyoo_dataTable?.[PREF_KEY] === true;
}

function restoreSingleApiPrompt() {
    if (independentEnabled()) return;
    const settings = USER?.getSettings?.();
    if (!settings) return;
    if (!settings.muyoo_dataTable || typeof settings.muyoo_dataTable !== 'object') {
        settings.muyoo_dataTable = {};
    }

    if (settings.muyoo_dataTable.message_template !== STRONG_SINGLE_API_TEMPLATE) {
        settings.muyoo_dataTable.message_template = STRONG_SINGLE_API_TEMPLATE;
        USER.saveSettings?.();
        console.log('[Memo] 一次API：已应用紧凑固定tableEdit协议');
    }
}

restoreSingleApiPrompt();
queueMicrotask(restoreSingleApiPrompt);
setTimeout(restoreSingleApiPrompt, 250);

const promptEvent = APP.event_types.CHAT_COMPLETION_PROMPT_READY;
APP.eventSource.on(promptEvent, restoreSingleApiPrompt);
if (typeof APP.eventSource.makeFirst === 'function') {
    APP.eventSource.makeFirst(promptEvent, restoreSingleApiPrompt);
}

console.log('[Memo] 一次API紧凑固定tableEdit协议已加载');
