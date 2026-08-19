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
- 正常完成剧情/回答正文后，必须继续执行一次表格状态检查，不能在正文结束时直接停止。
- 按0→1→2→3→4→5逐表检查；已有同一对象优先update，禁止重复insert。
- 不猜测未知；未知信息留空。
- 每一轮最终回复都必须在正文末尾输出且仅输出一个完整的<tableEdit>...</tableEdit>区块，禁止省略。
- 如果本轮存在需要写入、更新或删除的事实，在<tableEdit>中放入实际的insertRow/updateRow/deleteRow操作。
- 如果本轮检查后确认没有任何需要写入、更新或删除的事实，也必须输出<tableEdit><!-- NO_CHANGE --></tableEdit>，表示已经完成检查。
- 表格操作必须真实出现在最终回复文本中，不能只在思考/推理中处理，不能用自然语言替代。
- 所有本轮必要操作放在同一个<tableEdit>中。
# 固定收尾协议
有变化时：
<tableEdit>
<!-- 实际的insertRow/updateRow/deleteRow -->
</tableEdit>
无变化时：
<tableEdit><!-- NO_CHANGE --></tableEdit>
# 重要
完成正文后不要直接结束回复；必须先输出上述tableEdit区块后才能结束。`;

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
        console.log('[Memo] 一次API：已应用固定tableEdit收尾协议');
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

console.log('[Memo] 一次API固定tableEdit协议已加载');
