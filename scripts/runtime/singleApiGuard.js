import { APP, USER } from '../../core/manager.js';

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

const STATUS_ID = 'memo-single-api-status';
let lastInjected = false;

function applySingleApiPrerequisites() {
    const settings = USER?.tableBaseSetting;
    if (!settings) return false;

    // Memo 已加载时，AI记忆能力必须处于开启状态；否则核心的注入和解析入口都会直接 return。
    settings.isExtensionAble = true;
    settings.isAiReadTable = true;
    settings.isAiWriteTable = true;
    settings.injection_mode = 'deep_system';
    settings.deep = 1;
    settings.message_template = SINGLE_API_TEMPLATE;
    return true;
}

function ensureStatusNode() {
    const toggle = document.querySelector('#memory-independent-record-api');
    if (!toggle) return null;
    let node = document.getElementById(STATUS_ID);
    if (!node) {
        node = document.createElement('small');
        node.id = STATUS_ID;
        node.className = 'toggle-description justifyLeft';
        node.style.display = 'block';
        node.style.margin = '2px 0 8px';
        node.style.opacity = '.72';
        toggle.after(node);
    }
    return node;
}

function setStatus(text) {
    const node = ensureStatusNode();
    if (node) node.textContent = `单API状态：${text}`;
}

function registerDiagnostics() {
    // 只做观测，不接管核心逻辑。注册在主插件之后，可看到核心注入后的 eventData。
    APP.eventSource?.on?.(APP.event_types.CHAT_COMPLETION_PROMPT_READY, eventData => {
        if (USER.tableBaseSetting.step_by_step === true) return;
        const messages = Array.isArray(eventData?.chat) ? eventData.chat : [];
        const joined = messages.map(m => String(m?.content || '')).join('\n');
        lastInjected = joined.includes('# Memo 世界状态记忆') && joined.includes('insertRow(') && joined.includes('角色状态表');
        setStatus(lastInjected ? '写表提示已注入，等待AI回复' : '未检测到写表提示注入');
        console.log('[Memo][single-api] prompt injected =', lastInjected);
    });

    APP.eventSource?.on?.(APP.event_types.CHARACTER_MESSAGE_RENDERED, chatId => {
        if (USER.tableBaseSetting.step_by_step === true) return;
        const chat = USER.getContext()?.chat?.[Number(chatId)];
        const text = String(chat?.mes || '');
        if (!lastInjected) {
            setStatus('本轮未注入写表提示');
            return;
        }
        if (!/<tableEdit>[\s\S]*?<\/tableEdit>/.test(text)) {
            setStatus('提示已注入，但AI未返回tableEdit');
            console.log('[Memo][single-api] no tableEdit in assistant message', text);
            return;
        }
        setTimeout(() => {
            const matches = Array.isArray(chat?.tableEditMatches) ? chat.tableEditMatches : [];
            setStatus(matches.length ? '已收到并解析tableEdit' : 'AI有tableEdit，但核心未记录解析结果');
            console.log('[Memo][single-api] tableEdit matches =', matches);
        }, 0);
    });
}

function start() {
    applySingleApiPrerequisites();
    [0, 100, 300, 800, 1500, 2500].forEach(delay => {
        setTimeout(() => {
            applySingleApiPrerequisites();
            ensureStatusNode();
        }, delay);
    });

    // index.js 的 ready 回调先注册核心监听；这里稍后注册诊断监听，避免抢在核心前面。
    setTimeout(registerDiagnostics, 0);
}

start();
console.log('[Memo] 单API运行守卫已加载：总开关/读写/注入固定开启，并启用链路诊断');
