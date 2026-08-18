import { USER } from '../../core/manager.js';

const SINGLE_API_TEMPLATE = `# Memo 世界状态记忆
你在完成正常剧情回复的同时，负责维护下方六张状态表。不要向用户解释表格维护过程。

## 当前表格与各表增删改规则
{{tableData}}

## 可用操作
insertRow(tableIndex:number,data:{[colIndex:number]:string|number})
updateRow(tableIndex:number,rowIndex:number,data:{[colIndex:number]:string|number})
deleteRow(tableIndex:number,rowIndex:number)

## 强制规则
- 先正常完成本轮回复，再依据“本轮用户行为 + 本轮结果”检查表格变化。
- 检查顺序固定为：0当前状态 → 1角色状态 → 2背包 → 3当前任务与约定 → 4人物 → 5历史事件。
- 表1只记录玩家本人；NPC只进入表4。
- 同一人物的姓名、昵称、外号、道号、职衔、描述性称呼视为同一身份体系；已有同一人物时优先update，禁止因叫法不同重复insert。
- NPC只有描述性称呼时可暂作姓名；正式名字确认后使用正式名字，临时描述称呼不永久保留。
- 性别只记录明确事实；未知、没有、未提及的信息留空，不猜测，不写占位词。
- 属性统一使用“神识”；“神魂”仅在确实表示灵魂/魂魄本体时使用。
- 只有确有变化才写表。若有变化，必须在整段回复最末尾输出且只输出一个：
<tableEdit><!--
updateRow(...)
insertRow(...)
deleteRow(...)
--></tableEdit>
- 没有任何表格变化时，不输出<tableEdit>。
- <tableEdit>是后台机器指令，不属于正文，不要解释、引用或改写其中内容。`;

function applySingleApiPrerequisites() {
    const settings = USER?.tableBaseSetting;
    if (!settings) return false;

    // 单API依赖主请求注入，隐藏的旧设置不允许再关闭或改变这条链路。
    settings.isAiReadTable = true;
    settings.isAiWriteTable = true;
    settings.injection_mode = 'deep_system';
    settings.deep = 0;
    settings.message_template = SINGLE_API_TEMPLATE;
    return true;
}

function start() {
    applySingleApiPrerequisites();
    // 原插件设置初始化可能稍晚覆盖一次，因此在初始化窗口内再校正。
    [0, 100, 300, 800, 1500, 2500].forEach(delay => {
        setTimeout(applySingleApiPrerequisites, delay);
    });
}

start();
console.log('[Memo] 单API运行守卫已加载：固定主请求写表模板与system末端注入');
