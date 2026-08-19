import { APP, USER } from '../../core/manager.js';

const PREF_KEY = 'independent_record_api_enabled';
const ORIGINAL_SINGLE_API_TEMPLATE = `# dataTable 世界状态记忆
## 表格：0当前状态 / 1角色状态 / 2背包 / 3当前任务与约定 / 4人物 / 5历史事件
{{tableData}}
# 操作
insertRow(tableIndex:number,data:{[colIndex:number]:string|number})
updateRow(tableIndex:number,rowIndex:number,data:{[colIndex:number]:string|number})
deleteRow(tableIndex:number,rowIndex:number)
# 规则
- 检查顺序0→1→2→3→4→5；已有同一对象优先update，禁止重复insert。
- 不猜测未知；未知信息留空。
- 正文后仅在确有变化时输出<tableEdit><!-- 函数调用 --></tableEdit>。`;

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

    if (settings.muyoo_dataTable.message_template !== ORIGINAL_SINGLE_API_TEMPLATE) {
        settings.muyoo_dataTable.message_template = ORIGINAL_SINGLE_API_TEMPLATE;
        USER.saveSettings?.();
        console.log('[Memo] 一次API：已恢复原作者兼容短提示模板');
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

console.log('[Memo] 一次API原作者提示恢复器已加载');
