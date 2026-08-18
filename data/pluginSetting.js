import { BASE, DERIVED, EDITOR, SYSTEM, USER } from '../core/manager.js';
import {switchLanguage} from "../services/translate.js";

export async function filterTableDataPopup(originalData, title, warning) {
    const confirmation = new EDITOR.Popup($('<div></div>').append($(`<span>${title}</span>`)).append('<br>').append($(`<span style="color: rgb(211, 39, 39)">${warning}</span>`)), EDITOR.POPUP_TYPE.CONFIRM, '', { okButton: "继续", cancelButton: "取消" });
    await confirmation.show();
    return { filterData: confirmation.result ? originalData : null, confirmation: !!confirmation.result };
}

export const defaultSettings = await switchLanguage('__defaultSettings__', {
    isExtensionAble: true,
    tableDebugModeAble: false,
    isAiReadTable: true,
    isAiWriteTable: true,
    updateIndex: 6,
    injection_mode: 'deep_system',
    deep: 1,
    message_template: `# dataTable 世界状态记忆\n## 表格：0当前状态 / 1角色状态 / 2背包 / 3当前任务与约定 / 4人物 / 5历史事件\n{{tableData}}\n# 操作\ninsertRow(tableIndex:number,data:{[colIndex:number]:string|number})\nupdateRow(tableIndex:number,rowIndex:number,data:{[colIndex:number]:string|number})\ndeleteRow(tableIndex:number,rowIndex:number)\n# 规则\n- 检查顺序0→1→2→3→4→5；已有同一对象优先update，禁止重复insert。\n- 不猜测未知；未知信息留空。\n- 正文后仅在确有变化时输出<tableEdit><!-- 函数调用 --></tableEdit>。`,
    isTableToChat: false,
    show_settings_in_extension_menu: true,
    alternate_switch: true,
    show_drawer_in_extension_list: true,
    table_to_chat_can_edit: false,
    table_to_chat_mode: 'context_bottom',
    table_cell_width_mode: 'wide1_2_cell',
    to_chat_container: `<div class="table-preview-bar"><details><summary style="display:flex;justify-content:space-between"><span>记忆增强表格</span></summary>$0</details></div>`,
    confirm_before_execution: true,
    use_main_api: true,
    custom_temperature: 1.0,
    custom_max_tokens: 2048,
    custom_top_p: 1,
    bool_ignore_del: true,
    ignore_user_sent: false,
    clear_up_stairs: 9,
    use_token_limit: true,
    rebuild_token_limit_value: 10000,
    refresh_system_message_template: `你是世界状态表格整理助手。只根据已确认事实维护现有表格。优先更新已有行，不写流水账，不猜测未知。只输出<tableEdit>。`,
    refresh_user_message_template: `<聊天记录>\n$1\n</聊天记录>\n<当前表格>\n$0\n</当前表格>\n<表头信息>\n$2\n</表头信息>\n按0当前状态→1角色状态→2背包→3任务约定→4人物→5历史事件检查。同一对象已有行优先update；不猜测未知。函数放在<tableEdit><!-- ... --></tableEdit>中。`,
    rebuild_default_system_message_template: '',
    rebuild_default_message_template: '',
    lastSelectedTemplate: 'rebuild_base',
    rebuild_message_template_list: {},
    additionalPrompt: '',
    step_by_step: false,
    step_by_step_use_main_api: true,
    step_by_step_user_prompt: `<聊天记录>\n$1\n</聊天记录>\n<操作规则>\n$3\n</操作规则>`,
    bool_silent_refresh: false,
    separateReadContextLayers: 1,
    separateReadLorebook: false,
    tableStructure: [
        {tableName:'当前状态表',tableIndex:0,columns:['日期','时间','地点','当前场景人物'],enable:true,Required:true,asStatus:true,toChat:true,note:'当前世界场景快照，只保留最新一行',initNode:'没有记录时插入当前已确认状态',insertNode:'仅当表为空时插入',updateNode:'日期/时间/地点/当前场景人物变化时直接覆盖',deleteNode:'出现多行时只保留最新有效一行'},
        {tableName:'角色状态表',tableIndex:1,columns:['姓名','性别','种族','年龄','修为','灵根/体质','灵力','神识','身体状态','灵石','钱财','技能/术法','擅长','其他状态'],enable:true,Required:true,asStatus:true,toChat:true,note:'<user>/玩家本人专属实时状态表，只允许一行；禁止记录任何NPC',initNode:'首次得到<user>/玩家本人的明确状态信息时插入',insertNode:'仅当表为空且对象明确为<user>/玩家本人时插入',updateNode:'仅更新<user>/玩家本人；当前值覆盖旧值',deleteNode:'重复玩家状态行只保留最新有效一行'},
        {tableName:'背包表',tableIndex:2,columns:['物品名','类型','数量','状态/品质','备注'],enable:true,Required:false,asStatus:true,toChat:true,note:'<user>当前实际持有物品，按物品名动态维护',initNode:'记录当前实际持有且值得追踪的物品',insertNode:'获得新物品时插入',updateNode:'数量/品质/状态/备注变化时更新已有行',deleteNode:'数量为0/明确丢失/消耗完/不再持有时删除'},
        {tableName:'当前任务与约定表',tableIndex:3,columns:['事项','相关人物','内容','地点/期限','当前状态'],enable:true,Required:false,asStatus:true,toChat:true,note:'只保存尚未结束的任务/承诺/交易/约定',initNode:'存在尚未完成的重要事项时记录',insertNode:'出现新的未结束事项时插入',updateNode:'进度/地点/期限/状态变化时更新同一行',deleteNode:'完成/失败/取消/失效后删除；重大结果可写入历史'},
        {tableName:'人物表',tableIndex:4,columns:['姓名','别名/称呼','性别','身份/所属','修为','外貌特征','性格','与玩家关系','当前状态','重要信息'],enable:true,Required:true,asStatus:true,toChat:true,note:'NPC专属长期人物表，禁止记录<user>/玩家本人；同一NPC一行',initNode:'只记录后续值得继续引用的NPC',insertNode:'出现新的重要NPC且表中没有时插入',updateNode:'更新同一NPC的已确认信息',deleteNode:'重复NPC行删除并合并信息；死亡通常更新状态而非删除'},
        {tableName:'历史事件表',tableIndex:5,columns:['时间','地点','涉及人物','事件','结果'],enable:true,Required:true,asStatus:true,toChat:true,note:'有限追加的重要历史，只记录影响后续的既成事件',initNode:'仅补录真正重要的既成事件',insertNode:'死亡/突破/重大冲突结果/关系重大转折/身份变化/重要获得或永久损失时插入',updateNode:'仅纠正明确错误或补最终结果时更新',deleteNode:'重复或明确错误的历史行可删除'},
    ],
});
