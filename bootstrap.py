from pathlib import Path
import re

# 仅修改配置/提示词/界面接入层；不修改 core/table 与 scripts/runtime 核心执行链。

p=Path('data/pluginSetting.js')
s=p.read_text(encoding='utf-8')
s=s.replace('updateIndex:3,','updateIndex:5,',1)

# 默认六表：高频在前。
start=s.index('    tableStructure: [')
end=s.index('    ],\n});', start)+6
structure='''    tableStructure: [
        {tableName:"当前状态表",tableIndex:0,columns:['日期','时间','地点','当前场景人物'],enable:true,Required:true,asStatus:true,toChat:true,note:"当前世界场景快照，只保留最新一行",initNode:'没有记录时插入当前已确认状态',insertNode:'仅当表为空时插入',updateNode:'日期/时间/地点/当前场景人物变化时直接覆盖',deleteNode:'出现多行时只保留最新有效一行'},
        {tableName:'角色状态表',tableIndex:1,columns:['姓名','种族','年龄','修为','灵根/体质','灵力','神识','身体状态','灵石','钱财','技能/术法','擅长','其他状态'],enable:true,Required:true,asStatus:true,toChat:true,note:'<user>当前角色状态，只保留最新一行；未显示不代表不存在',initNode:'首次得到明确角色信息时插入',insertNode:'仅当表为空时插入',updateNode:'修为/灵力/神识/身体/财物/技能/擅长等变化时更新；当前值覆盖旧值',deleteNode:'重复状态行只保留最新有效一行'},
        {tableName:'背包表',tableIndex:2,columns:['物品名','类型','数量','状态/品质','备注'],enable:true,Required:false,asStatus:true,toChat:true,note:'<user>当前实际持有物品，按物品名动态维护',initNode:'记录当前实际持有且值得追踪的物品',insertNode:'获得新物品时插入',updateNode:'数量/品质/状态/备注变化时更新已有行',deleteNode:'数量为0/明确丢失/消耗完/不再持有时删除'},
        {tableName:'当前任务与约定表',tableIndex:3,columns:['事项','相关人物','内容','地点/期限','当前状态'],enable:true,Required:false,asStatus:true,toChat:true,note:'只保存尚未结束的任务/承诺/交易/约定',initNode:'存在尚未完成的重要事项时记录',insertNode:'出现新的未结束事项时插入',updateNode:'进度/地点/期限/状态变化时更新同一行',deleteNode:'完成/失败/取消/失效后删除；重大结果可写入历史'},
        {tableName:'人物表',tableIndex:4,columns:['姓名','身份/所属','修为','外貌特征','性格','与玩家关系','当前状态','重要信息'],enable:true,Required:true,asStatus:true,toChat:true,note:'值得长期记忆的NPC；同一人物一行；插件按当前场景与关系自动排序',initNode:'只记录后续值得继续引用的NPC',insertNode:'出现新的重要NPC且表中没有时插入',updateNode:'身份/修为/关系/状态/重要信息变化时更新原行',deleteNode:'重复人物行删除；死亡通常更新状态而非删除'},
        {tableName:'历史事件表',tableIndex:5,columns:['时间','地点','涉及人物','事件','结果'],enable:true,Required:true,asStatus:true,toChat:true,note:'有限追加的重要历史，只记录影响后续的既成事件',initNode:'仅补录真正重要的既成事件',insertNode:'死亡/突破/重大冲突结果/关系重大转折/身份变化/重要获得或永久损失时插入',updateNode:'仅纠正明确错误或补最终结果时更新',deleteNode:'重复或明确错误的历史行可删除'},
    ],
'''
s=s[:start]+structure+s[end:]

# 主更新提示词：保留原有 insert/update/delete 语法，只改变决策规则。
start=s.index('    message_template: `# dataTable 说明')
end=s.index('    /**\n     * ===========================\n     * 推送表格设置',start)
msg='''    message_template: `# dataTable 世界状态记忆
## 表格：0当前状态 / 1角色状态 / 2背包 / 3当前任务与约定 / 4人物 / 5历史事件
{{tableData}}
# 操作
insertRow(tableIndex:number,data:{[colIndex:number]:string|number})
updateRow(tableIndex:number,rowIndex:number,data:{[colIndex:number]:string|number})
deleteRow(tableIndex:number,rowIndex:number)
# 规则
- 检查顺序0→1→2→3→4→5；已有同一对象优先update，禁止重复insert。
- 0和1原则上只有一行，时间/地点/修为/灵力/神识/伤势/灵石/钱财等当前值直接覆盖旧值。
- 技能/术法、擅长只合并实际掌握且仍有效内容；明确失去时移除。
- 背包同物品一行；数量变化update，数量0或失去时delete。
- 任务/约定只保存未结束事项；完成/失败/取消/失效后delete，重大结果可进入历史。
- 人物同名一行；关系/修为/状态变化覆盖当前值；普通路人不长期记录。
- 历史只追加会影响后续的重要既成事件，普通日常不记录。
- 不猜测未知，不为剧情方便改写既成事实；未知可留空；并列内容用 / 分隔。
- 正文后仅在确有变化时输出<tableEdit><!-- 函数调用 --></tableEdit>。
`,
'''
s=s[:start]+msg+s[end:]

# 刷新提示词压缩为动态维护规则。
start=s.index('    refresh_system_message_template:')
end=s.index('    // 用于“完整重建表格”的提示词模板',start)
refresh='''    refresh_system_message_template:`你是世界状态表格整理助手。只根据已确认事实维护现有表格。优先更新已有行，不写流水账，不猜测未知。只输出<tableEdit>。`,
    refresh_user_message_template:`<聊天记录>\\n$1\\n</聊天记录>\\n<当前表格>\\n$0\\n</当前表格>\\n<表头信息>\\n$2\\n</表头信息>\\n按0当前状态→1角色状态→2背包→3任务约定→4人物→5历史事件检查。同一对象已有行优先update；0/1覆盖最新值；背包数量0删除；任务结束删除；人物同名合并；历史仅重大既成事件。不猜测未知。函数放在<tableEdit><!-- ... --></tableEdit>中。`,
'''
s=s[:start]+refresh+s[end:]
p.write_text(s,encoding='utf-8')

# 重建配置改为轻量世界状态整理。
Path('data/profile_prompts.js').write_text('''import {switchLanguage} from "../services/translate.js";\nconst rules=`<整理规则>保持六张表结构不变。0当前状态与1角色状态只保留最新一行；2背包同物品合并并删除已失去物品；3任务约定只留未结束事项；4人物同名合并更新当前关系/修为/状态；5历史仅保留影响后续的重大既成事件。优先更新而非累积，不猜测未知，不回滚既成事实。</整理规则>`;\nexport const profile_prompts=await switchLanguage('__profile_prompts__',{rebuild_base:{type:'rebuild',name:'动态整理（世界状态表）',system_prompt:'你是世界状态表格整理助手，只依据已确认事实整理。',user_prompt_begin:'结合聊天和当前表格重建，只回复<新的表格>：',include_history:true,include_last_table:true,core_rules:rules},rebuild_compatible:{type:'rebuild',name:'兼容整理（自定义表格）',system_prompt:'保持现有表结构，只合并、更新、删除重复或失效内容。',user_prompt_begin:'根据聊天和当前表格整理，只回复<新的表格>：',include_history:true,include_last_table:true,core_rules:'<整理规则>保持表结构；已有对象优先更新；不猜测未知。</整理规则>'},rebuild_summary:{type:'rebuild',name:'完整重建（世界状态表）',system_prompt:'依据全部可见聊天重建当前状态与重要历史。',user_prompt_begin:'完整检查聊天和当前表格，只回复<新的表格>：',include_history:true,include_last_table:true,core_rules:rules}});\n''',encoding='utf-8')

# 新增轻量人物动态排序；排序失败不影响核心更新。
Path('utils/tableSorting.js').write_text('''function n(v){return String(v??'').trim()}\nfunction rp(v){const r=n(v),g=[[/道侣|伴侣|夫妻|至亲|亲人|家人/,10],[/挚友|知己|亲密|爱慕|恋人|师父|师尊|徒弟|弟子/,20],[/盟友|朋友|友好|信任|同伴|伙伴/,30],[/死敌|仇敌|敌对|追杀|仇恨|宿敌/,35],[/戒备|警惕|冲突|竞争|不和/,40],[/熟人|认识|同门|同事|邻居/,50],[/陌生|路人|未知|无/,90]];for(const [p,s] of g)if(p.test(r))return s;return 60}\nexport function applyDynamicTableSorting(sheets){try{const st=sheets.find(x=>x?.name==='当前状态表'),row=st?.getContent?.()?.[0],names=new Set(n(row?.[3]).split(/[\\/、，,;；\\s]+/).filter(Boolean)),sh=sheets.find(x=>x?.name==='人物表');if(!sh?.getContent||!sh?.rebuildHashSheetByValueSheet)return;const rows=sh.getContent();if(rows.length<2)return;const a=rows.map((r,i)=>({r,i}));a.sort((x,y)=>{const sx=names.has(n(x.r[0]))?0:1,sy=names.has(n(y.r[0]))?0:1;if(sx!==sy)return sx-sy;const d=rp(x.r[5])-rp(y.r[5]);return d||x.i-y.i});if(a.some((e,i)=>e.i!==i))sh.rebuildHashSheetByValueSheet([['',...sh.getHeader()],...a.map(e=>['',...e.r])])}catch(e){console.warn('[World Memory] 人物表排序失败，跳过：',e)}}\n''',encoding='utf-8')

# 只在高层保存点调用排序，不碰 executeAction / core/table。
p=Path('index.js');s=p.read_text(encoding='utf-8')
anchor="import { initExternalDataAdapter } from './external-data-adapter.js';\n"
s=s.replace(anchor,anchor+"import { applyDynamicTableSorting } from './utils/tableSorting.js';\n",1)
s=s.replace('''    for (const EditAction of sortActions(tableEditActions)) {\n        executeAction(EditAction, sheets)\n    }\n    sheets.forEach(sheet => sheet.save(piece, true))''','''    for (const EditAction of sortActions(tableEditActions)) {\n        executeAction(EditAction, sheets)\n    }\n    applyDynamicTableSorting(sheets)\n    sheets.forEach(sheet => sheet.save(piece, true))''',1)
s=s.replace('''    for (const EditAction of sortActions(tableEditActions)) {\n        executeAction(EditAction, sheets)\n    }\n\n    // 核心修复：确保修改被保存到当前最新的聊天片段中。''','''    for (const EditAction of sortActions(tableEditActions)) {\n        executeAction(EditAction, sheets)\n    }\n    applyDynamicTableSorting(sheets)\n\n    // 核心修复：确保修改被保存到当前最新的聊天片段中。''',1)
# 删除公开版本检查。
a=s.find('    // 版本检查\n    fetch("https://raw.githubusercontent.com/muyoou/st-memory-enhancement')
if a!=-1:
    b=s.find("\n\n    $('.extraMesButtons')",a)
    s=s[:a]+'    // 自用版：禁用公开仓库版本检查。\n    $("#tableUpdateTag").hide();\n    $("#table_message_tip").text("世界状态记忆表格 · 自用版");'+s[b:]
p.write_text(s,encoding='utf-8')

# 旧设置迁移到六表默认结构；不改核心表格类。
p=Path('scripts/settings/userExtensionSetting.js');s=p.read_text(encoding='utf-8')
needle='''    if (USER.tableBaseSetting.updateIndex < 4) {\n        // tableStructureToTemplate(USER.tableBaseSetting.tableStructure)\n        initTableStructureToTemplate()\n        USER.tableBaseSetting.updateIndex = 4\n    }'''
rep=needle+'''\n    if (USER.tableBaseSetting.updateIndex < 5) {\n        USER.tableBaseSetting.tableStructure = JSON.parse(JSON.stringify(USER.tableBaseDefaultSettings.tableStructure));\n        initTableStructureToTemplate();\n        USER.tableBaseSetting.updateIndex = 5;\n    }'''
if needle in s:s=s.replace(needle,rep,1)
p.write_text(s,encoding='utf-8')

# UI 删除项目地址/教程/更新记录入口，保留调试日志。
p=Path('assets/templates/index.html');s=p.read_text(encoding='utf-8')
a=s.find('                    <!-- 记忆增强表格管理 -->');b=s.find('                    <div id="table_message_tip"></div>',a)
if a!=-1 and b!=-1:s=s[:a]+'''                    <!-- 自用版：仅保留本地调试日志 -->\n                    <div style="display:flex; justify-content:flex-end;"><div class="menu_button_icon menu_button interactable" id="table_debug_log_button"><i class="fa-solid fa-bug"></i><a data-i18n="Logs">Log</a></div></div>\n'''+s[b:]
p.write_text(s,encoding='utf-8')

Path('manifest.json').write_text('''{\n  "display_name":"世界状态记忆表格",\n  "loading_order":100,\n  "requires":[],\n  "optional":[],\n  "js":"index.js",\n  "css":"assets/styles/style.css",\n  "author":"private",\n  "version":"2.2.18-world.1"\n}\n''',encoding='utf-8')
Path('README.md').write_text('# 世界状态记忆表格\n\nSillyTavern 自用记忆插件。默认六表：当前状态、角色状态、背包、当前任务与约定、人物、历史事件。\n\n保留原插件稳定的表格增删改核心，仅调整默认表结构、动态维护提示词、人物排序与自用界面。\n',encoding='utf-8')
