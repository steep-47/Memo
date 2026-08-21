import { APP, USER } from '../../core/manager.js';
import { defaultSettings } from '../../data/pluginSetting.js';

const PREF_KEY = 'independent_record_api_enabled';
const PROTOCOL_START = '[一次API固定收尾协议]';
const PROTOCOL_END = '[/一次API固定收尾协议]';

const KNOWN_OLD_OUTPUT_RULES = [
    '- 正文后仅在确有表格操作时输出<tableEdit><!-- 函数调用 --></tableEdit>。所有必要表格操作放在同一个<tableEdit>中。',
    '- 正文后必须以一个完整<tableEdit>结束：有表格变化时写入所有必要的insertRow/updateRow/deleteRow；没有任何需要记录的变化时输出<tableEdit><!-- NO_CHANGE --></tableEdit>。',
    '- 剧情/回答主体写完后，先立即输出一个完整<tableEdit>：有表格变化时写入所有必要的insertRow/updateRow/deleteRow；没有任何需要记录的变化时输出<tableEdit><!-- NO_CHANGE --></tableEdit>。随后再写参考行动、选项、伊依留言等回复尾部内容。',
    '- 最终回复必须先输出恰好一个完整<tableEdit>机器记录，再开始剧情/回答正文；有表格变化时写入所有必要的insertRow/updateRow/deleteRow，没有任何需要记录的变化时输出<tableEdit><!-- NO_CHANGE --></tableEdit>。tableEdit之后再正常写正文、参考行动、选项和留言。',
];

const STRUCTURED_OUTPUT_RULE = '- 一次API模式使用结构化双字段响应：table_edit只填写必要的insertRow/updateRow/deleteRow操作代码，无变化填写NO_CHANGE；reply只填写给用户看的正常完整回复。reply保持角色原有自然顺序（正文→参考行动/选项→留言等），不得出现<tableEdit>、JSON说明或机器记录。';

const SINGLE_API_PROTOCOL = `
${PROTOCOL_START}
# 一次API双通道协议
- 本轮只有一次模型/API请求。API层会在请求末尾指定本轮使用JSON结构或tableEdit标签；必须严格遵守最后出现的传输格式，不能自行省略机器字段。
- table_edit：只写本轮七张表需要执行的 insertRow / updateRow / deleteRow 代码；不要包<tableEdit>、不要Markdown、不要解释。没有任何变化时准确填写 NO_CHANGE。
- updateRow/deleteRow中的rowIndex只能抄当前表格数据第一列已经明确显示的数字。若某表显示“（此表格当前为空）”，该表严禁update/delete，首次记录只能insertRow；禁止把tableIndex、列号或新增后的预计行号误当rowIndex。
- reply：只写用户真正应该看到的完整正常回复，严格保持角色卡/世界书要求的风格和自然结构；正文、参考行动/选项、伊依留言等均写在reply内部。
- reply中禁止出现Memo、tableEdit、JSON结构说明、表格操作代码或“正在记录”等机器层内容。
- 表4人物主表与表5人物发展表继续通过同一NPC姓名关联；已有对象优先update，禁止重复insert。
- 年龄与最后确认时间是表5两个独立字段，不得混写。
- 不要把机器操作只写进思考/reasoning；最终结构中的table_edit字段必须实际给出操作或NO_CHANGE。
${PROTOCOL_END}`;

function independentEnabled() {
    return USER?.getSettings?.()?.muyoo_dataTable?.[PREF_KEY] === true;
}

function removeOwnProtocol(text) {
    const value = String(text || '');
    const start = value.indexOf(PROTOCOL_START);
    if (start < 0) return value;
    const end = value.indexOf(PROTOCOL_END, start);
    if (end < 0) return value.slice(0, start).trimEnd();
    return `${value.slice(0, start)}${value.slice(end + PROTOCOL_END.length)}`.trimEnd();
}

function normalizeOutputRule(text) {
    let value = String(text || '');
    for (const oldRule of KNOWN_OLD_OUTPUT_RULES) {
        if (value.includes(oldRule)) value = value.replace(oldRule, STRUCTURED_OUTPUT_RULE);
    }
    if (!value.includes(STRUCTURED_OUTPUT_RULE)) {
        const outputHeading = '# 输出';
        if (value.includes(outputHeading)) value = value.replace(outputHeading, `${outputHeading}\n${STRUCTURED_OUTPUT_RULE}`);
        else value = `${value.trim()}\n${STRUCTURED_OUTPUT_RULE}`.trim();
    }
    return value;
}

function isMemo38Replacement(text) {
    const value = String(text || '');
    return value.includes('# Memo 本轮任务') && value.includes('# 硬性结束协议') && value.includes('# 世界状态记忆表');
}

function buildSingleApiTemplate(currentTemplate) {
    let base = String(currentTemplate || '').trim();
    if (!base || isMemo38Replacement(base)) base = String(defaultSettings?.message_template || '').trim();
    base = normalizeOutputRule(removeOwnProtocol(base));
    return `${base}\n\n${SINGLE_API_PROTOCOL.trim()}`.trim();
}

function restoreSingleApiPrompt() {
    if (independentEnabled()) return;
    const settings = USER?.getSettings?.();
    if (!settings) return;
    if (!settings.muyoo_dataTable || typeof settings.muyoo_dataTable !== 'object') settings.muyoo_dataTable = {};

    const current = settings.muyoo_dataTable.message_template;
    const next = buildSingleApiTemplate(current);
    if (current !== next) {
        settings.muyoo_dataTable.message_template = next;
        USER.saveSettings?.();
        console.log('[Memo] 一次API：已恢复正文自然顺序并切换结构化双通道协议');
    }
}

// 同步代码默认对象，避免新会话/设置重建再次拿到memo73的tableEdit-first规则。
try {
    defaultSettings.message_template = buildSingleApiTemplate(defaultSettings.message_template);
} catch (error) {
    console.warn('[Memo] 默认一次API结构化协议归一失败', error);
}

restoreSingleApiPrompt();
queueMicrotask(restoreSingleApiPrompt);
setTimeout(restoreSingleApiPrompt, 250);
const promptEvent = APP.event_types.CHAT_COMPLETION_PROMPT_READY;
APP.eventSource.on(promptEvent, restoreSingleApiPrompt);
if (typeof APP.eventSource.makeFirst === 'function') APP.eventSource.makeFirst(promptEvent, restoreSingleApiPrompt);

console.log('[Memo] 一次API结构化提示协议已加载；可见回复恢复自然顺序');
