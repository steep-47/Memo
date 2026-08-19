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
    message_template: `# dataTable 说明
## 用途
- dataTable 是用于保存世界状态与长期记忆的表格，也是生成后续正文的重要参考。
- 你需要先正常完成本轮正文，再根据本轮已确认事实检查 dataTable 是否需要更新。

## 数据与格式
- 下方包含当前全部表格、表头、已有行、表格说明和增删改触发条件。
- 表名格式：[tableIndex:表名]。
- 列名格式：[colIndex:列名]。
- 行号格式：[rowIndex]。

{{tableData}}

# 增删改 dataTable 操作方法
当你生成正文后，必须按照每张表的【增删改触发条件】逐表检视。只有确有变化时才修改；没有变化的表不要操作。
如需修改，请在正文末尾输出一个 <tableEdit> 标签，并在其中使用以下函数。

## 操作规则（必须严格遵守）
<OperateRule>
- 插入新行：
insertRow(tableIndex:number, data:{[colIndex:number]:string|number})
- 删除已有行：
deleteRow(tableIndex:number, rowIndex:number)
- 更新已有行：
updateRow(tableIndex:number, rowIndex:number, data:{[colIndex:number]:string|number})
</OperateRule>

## 重要操作原则（必须遵守）
- 每次回复完成正文后，都必须检查 0→1→2→3→4→5 六张表是否需要增删改。
- 已有同一对象、人物、物品、事项时优先 updateRow，禁止因为描述变化或称呼变化重复 insertRow。
- 只记录剧情已经明确确认的事实；禁止猜测、补全或杜撰未知信息。
- 未知、没有、未提及的字段留空，不写“未知、暂无、无、N/A”等占位词。
- 表1“角色状态表”只记录 <user>/玩家本人；任何 NPC 都不得写入表1。
- 表4“人物表”只记录 NPC；<user>/玩家本人不得写入表4。
- 同一 NPC 的姓名、昵称、外号、道号、职衔与描述性称呼属于同一身份体系；正式名字确认后使用正式名字，真实且仍使用的称呼放入“别名/称呼”。
- 性别只在剧情明确时记录，不得根据姓名、外貌、衣着或称呼猜测。
- 属性统一使用“神识”；“神魂”仅在确实表示灵魂/魂魄本体时使用。
- insertRow 时应填写本轮已经明确知道的相关列；不要为了填满表格而猜测。
- <tableEdit> 内必须使用 <!-- --> 注释包裹函数调用。
- <tableEdit> 是后台表格编辑指令，不属于剧情正文，不要解释它。

# 输出格式示例
如果本轮有需要记录的变化，正文结束后追加：
<tableEdit>
<!--
updateRow(0, 0, {1:"午后", 2:"青云宗山门"})
insertRow(4, {0:"林青", 1:"林师兄", 2:"男", 3:"青云宗外门弟子", 8:"在场"})
insertRow(5, {0:"今日", 1:"青云宗山门", 2:"<user>/林青", 3:"双方首次见面", 4:"建立初步联系"})
-->
</tableEdit>
如果本轮确实没有任何表格变化，则不要输出 <tableEdit>。`,
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
    step_by_step_user_prompt: `[
  {"role":"system","content":"你是世界状态记忆表格整理助手。只根据已确认事实维护现有六张表；已有同一对象优先更新，不重复新建，不猜测未知。只输出<tableEdit><!-- 函数调用 --></tableEdit>。"},
  {"role":"user","content":"<操作规则与当前表格>\\n$3\\n</操作规则与当前表格>\\n<最近上下文>\\n$1\\n</最近上下文>\\n<本轮AI回复>\\n$2\\n</本轮AI回复>"}
]`,
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
