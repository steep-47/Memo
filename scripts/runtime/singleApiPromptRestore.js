import { APP, USER } from '../../core/manager.js';

const PREF_KEY = 'independent_record_api_enabled';
const STRONG_SINGLE_API_TEMPLATE = `# dataTable 世界状态记忆
## 表格：0当前状态 / 1角色状态 / 2背包 / 3当前任务与约定 / 4人物 / 5历史事件
{{tableData}}
# 可用操作
insertRow(tableIndex:number,data:{[colIndex:number]:string|number})
updateRow(tableIndex:number,rowIndex:number,data:{[colIndex:number]:string|number})
deleteRow(tableIndex:number,rowIndex:number)
# 表格维护规则
- 正常完成剧情/回答正文后，必须执行表格检查；tableEdit是本轮回复的必需结束字段，不是可选附加内容。
- 按0→1→2→3→4→5逐表检查；已有同一对象优先update，禁止重复insert。
- 区分获得/新增与查看已有物品：仅实际获得、失去、消耗或数量变化时修改背包；只是查看、提及、持有既有物品不得重复insert。一次性物品使用后应删除或减少数量。
- 不猜测未知；未知信息留空。
- 最终回复必须以且仅以一个完整<tableEdit>...</tableEdit>区块结束；输出该区块前不得结束回复。
- 有变化：在tableEdit中输出本轮全部必要的insertRow/updateRow/deleteRow。
- 无变化：仍必须输出<tableEdit><!-- NO_CHANGE --></tableEdit>。
- 操作必须真实出现在最终回复文本，不能只在思考/推理中处理，不能用自然语言替代。
# 回复结束条件
只有输出以下二者之一，本轮回复才算完成：
<tableEdit>
<!-- 实际的insertRow/updateRow/deleteRow -->
</tableEdit>
或
<tableEdit><!-- NO_CHANGE --></tableEdit>
正文结束不代表任务结束；tableEdit结束标签才代表整轮回复结束。`;

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
