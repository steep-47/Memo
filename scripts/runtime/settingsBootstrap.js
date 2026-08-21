import { defaultSettings } from '../../data/pluginSetting.js';
import applicationFunctionManager from '../../services/appFuncManager.js';

defaultSettings.table_cell_width_mode ??= 'wide1_2_cell';

const STEP_PROMPT_MARKER = '[Memo七表独立记录v3]';
const STEP_BY_STEP_PROMPT = `[
  { role: 'system', content: '${STEP_PROMPT_MARKER} 你是世界状态记忆维护器。只维护表格，不输出剧情正文。只依据已确认事实，不猜测未知。表4人物主表负责NPC身份识别；表5人物发展表负责最新发展锚点；表6历史事件表只保存重大既成节点。最终只输出一个完整<tableEdit>；无变化输出NO_CHANGE块。' },
  { role: 'user', content: '<已有七表>\\n$0\\n</已有七表>\\n<最近上下文>\\n$1\\n</最近上下文>\\n<本轮内容>\\n$2\\n</本轮内容>\\n<操作规则>\\n$3\\n</操作规则>\\n<世界书参考>\\n$4\\n</世界书参考>\\n逐表检查0→1→2→3→4→5→6。已有对象优先updateRow，新对象才insertRow，明确失效按规则deleteRow。表5字段“年龄”和“最后确认时间”必须分开：年龄是人物属性，最后确认时间是该发展锚点最后被剧情确认的世界时间；未知分别留空。只输出一个<tableEdit><!-- 函数调用 --></tableEdit>；若无变化输出<tableEdit><!-- NO_CHANGE --></tableEdit>。' }
]`;

defaultSettings.step_by_step_user_prompt = STEP_BY_STEP_PROMPT;

if (Array.isArray(defaultSettings.tableStructure)) {
    const dev = defaultSettings.tableStructure.find(item => item?.tableName === '人物发展表');
    if (dev) {
        dev.columns = ['姓名','修为','主要能力','当前地点','年龄','最后确认时间','当前状态','主要目标/重要事项'];
        dev.note = 'NPC专属最新发展锚点表；年龄与最后确认时间分列；同一NPC一行；只保存最后有效状态，不记录离线流水账';
        dev.updateNode = '新确认的修为/能力/地点/年龄/最后确认时间/重要状态/目标只更新对应字段；年龄与最后确认时间不得混写';
    }
    for (const table of defaultSettings.tableStructure) {
        if (table.tochat === undefined && table.toChat !== undefined) table.tochat = table.toChat;
    }
}

defaultSettings.message_template = String(defaultSettings.message_template || '')
    .replace(/年龄或最后确认时间/g, '年龄、最后确认时间')
    .replace(/年龄\/最后确认时间/g, '年龄、最后确认时间');

const DIRECT_OUTPUT_RULES = String(defaultSettings.message_template).split('# 输出\n')[1] || '';
function migrateKnownSingleApiOutput(template) {
    const source = String(template || '');
    if (!source.includes('# 输出')) return source;
    const knownOld = source.includes('一次API模式使用结构化双字段响应')
        || source.includes('具体传输格式只服从API请求末尾最后出现的协议')
        || source.includes('[一次API固定收尾协议]');
    if (!knownOld) return source;
    return `${source.split('# 输出')[0].trimEnd()}\n# 输出\n${DIRECT_OUTPUT_RULES}`.trim();
}

const REBUILD_MARKER = '[Memo七表整理v2]';
const REBUILD_SYSTEM_PROMPT = `${REBUILD_MARKER}\n你是世界状态数据库整理器。根据当前七张表与最近聊天，返回七张表整理后的最终状态。只依据已确认事实，不猜测未知，不模拟NPC离线生活。人物主表负责NPC身份识别，人物发展表保存NPC最后有效发展锚点，历史表只保存影响未来推演的重要既成节点。最终只能输出一个合法JSON数组，不输出Markdown、代码块、tableEdit、解释或前后缀。`;
const REBUILD_USER_PROMPT = `<当前表格>\n$0\n</当前表格>\n<聊天记录>\n$1\n</聊天记录>\n<固定表头>\n$2\n</固定表头>\n\n输出完整七表最终JSON数组，每个元素仅含tableName、tableIndex、columns、content。\n1.columns必须与固定表头完全一致。\n2.#0当前状态最多1行。\n3.#1角色状态只保存玩家本人。\n4.#2背包只保存当前实际持有库存。\n5.#3任务约定只保存未结束事项。\n6.#4人物主表同一NPC一行，保存稳定身份与关系信息。\n7.#5人物发展表同一NPC一行，字段为姓名、修为、主要能力、当前地点、年龄、最后确认时间、当前状态、主要目标/重要事项；年龄与最后确认时间必须分别维护，新事实覆盖对应旧锚点。\n8.#4和#5通过同一NPC姓名关联，身份不明时不得强行合并。\n9.#6历史事件只保留突破/失败、势力变化、婚姻亲属重大变化、重伤残疾/寿元损耗、重大机缘、战争/宗门覆灭、死亡等重要节点。\n10.空表也必须保留表对象并写content:[]；必须返回完整七表，不能返回[]。`;

defaultSettings.rebuild_default_system_message_template = REBUILD_SYSTEM_PROMPT;
defaultSettings.rebuild_default_message_template = REBUILD_USER_PROMPT;

function clone(value) {
    if (value === null || typeof value !== 'object') return value;
    try { return structuredClone(value); } catch (_) { return JSON.parse(JSON.stringify(value)); }
}

function isKnownOldMemoRebuildPrompt(systemPrompt, userPrompt) {
    const system = String(systemPrompt || '');
    const user = String(userPrompt || '');
    if (!system.trim()) return true;
    if (system.includes(REBUILD_MARKER)) return false;
    return system.includes('[Memo六表整理')
        || system.includes('[Memo七表整理v1]')
        || system.includes('世界状态数据库整理器')
        || system.includes('memo-six-table-final-state')
        || system.includes('返回六张表整理完成后的最终状态')
        || system.includes("role: 'system'")
        || (system.trim().startsWith('[') && system.includes('$0') && system.includes('$2'))
        || (!user.trim() && system.includes('六张表'));
}

function needsStepPromptUpgrade(value) {
    const text = String(value || '').trim();
    if (!text) return true;
    if (text.includes(STEP_PROMPT_MARKER)) return false;
    if (!text.startsWith('[') || !text.includes('role') || !text.includes('content')) return true;
    if (!text.includes('$0') || !text.includes('$2') || !text.includes('$3')) return true;
    if (!text.includes('$4')) return true;
    return text.includes('逐表检查0到5') || text.includes('六张表');
}

try {
    const root = applicationFunctionManager.power_user;
    if (root) {
        if (!root.muyoo_dataTable || typeof root.muyoo_dataTable !== 'object') root.muyoo_dataTable = {};
        const store = root.muyoo_dataTable;
        for (const [key, value] of Object.entries(defaultSettings)) if (!(key in store)) store[key] = clone(value);

        const migratedMessageTemplate = migrateKnownSingleApiOutput(store.message_template);
        if (migratedMessageTemplate !== store.message_template) {
            store.message_template = migratedMessageTemplate;
            console.log('[Memo][settings] 已一次性迁移旧结构化输出规则到原生直接记录协议');
        }

        if (needsStepPromptUpgrade(store.step_by_step_user_prompt)) {
            store.step_by_step_user_prompt = STEP_BY_STEP_PROMPT;
            console.log('[Memo][settings] 已修复独立记录API的JSON5消息数组提示与世界书占位');
        }

        if (store.lastSelectedTemplate === 'rebuild_base' && isKnownOldMemoRebuildPrompt(store.rebuild_default_system_message_template, store.rebuild_default_message_template)) {
            store.rebuild_default_system_message_template = REBUILD_SYSTEM_PROMPT;
            store.rebuild_default_message_template = REBUILD_USER_PROMPT;
        }

        store.step_by_step = false;
        applicationFunctionManager.saveSettingsDebounced?.();
        console.log('[Memo][settings] 七表默认设置与独立记录协议已归一化');
    }
} catch (error) {
    console.warn('[Memo][settings] bootstrap normalization failed:', error);
}

export { REBUILD_SYSTEM_PROMPT, REBUILD_USER_PROMPT, STEP_BY_STEP_PROMPT };
