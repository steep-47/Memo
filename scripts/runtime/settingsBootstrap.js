import { defaultSettings } from '../../data/pluginSetting.js';
import applicationFunctionManager from '../../services/appFuncManager.js';

defaultSettings.table_cell_width_mode ??= 'wide1_2_cell';

const REBUILD_MARKER = '[Memo七表整理v1]';
const REBUILD_SYSTEM_PROMPT = `${REBUILD_MARKER}\n你是世界状态数据库整理器。根据当前七张表与最近聊天，返回七张表整理后的最终状态。只依据已确认事实，不猜测未知，不模拟NPC离线生活。人物主表负责NPC身份识别，人物发展表保存NPC最后有效发展锚点，历史表只保存影响未来推演的重要既成节点。最终只能输出一个合法JSON数组，不输出Markdown、代码块、tableEdit、解释或前后缀。`;
const REBUILD_USER_PROMPT = `<当前表格>\n$0\n</当前表格>\n<聊天记录>\n$1\n</聊天记录>\n<固定表头>\n$2\n</固定表头>\n\n输出完整七表最终JSON数组，每个元素仅含tableName、tableIndex、columns、content。\n1.columns必须与固定表头完全一致。\n2.#0当前状态最多1行。\n3.#1角色状态只保存玩家本人。\n4.#2背包只保存当前实际持有库存。\n5.#3任务约定只保存未结束事项。\n6.#4人物主表同一NPC一行，保存姓名、性别、别名/称呼、身份/所属、外貌、性格、与玩家关系、长期重要信息。\n7.#5人物发展表同一NPC一行，保存姓名、修为、主要能力、当前地点、年龄或最后确认时间、当前状态、主要目标/重要事项；新事实覆盖旧锚点。\n8.#4和#5通过同一NPC姓名关联，身份不明时不得强行合并。\n9.#6历史事件只保留突破/失败、势力变化、婚姻亲属重大变化、重伤残疾/寿元损耗、重大机缘、战争/宗门覆灭、死亡等重要节点。\n10.空表也必须保留表对象并写content:[]；必须返回完整七表，不能返回[]。`;

defaultSettings.rebuild_default_system_message_template = REBUILD_SYSTEM_PROMPT;
defaultSettings.rebuild_default_message_template = REBUILD_USER_PROMPT;

if (Array.isArray(defaultSettings.tableStructure)) {
    for (const table of defaultSettings.tableStructure) {
        if (table.tochat === undefined && table.toChat !== undefined) table.tochat = table.toChat;
    }
}

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
        || system.includes('世界状态数据库整理器')
        || system.includes('memo-six-table-final-state')
        || system.includes('返回六张表整理完成后的最终状态')
        || system.includes("role: 'system'")
        || (system.trim().startsWith('[') && system.includes('$0') && system.includes('$2'))
        || (!user.trim() && system.includes('六张表'));
}

try {
    const root = applicationFunctionManager.power_user;
    if (root) {
        if (!root.muyoo_dataTable || typeof root.muyoo_dataTable !== 'object') root.muyoo_dataTable = {};
        const store = root.muyoo_dataTable;
        for (const [key, value] of Object.entries(defaultSettings)) if (!(key in store)) store[key] = clone(value);
        if (store.lastSelectedTemplate === 'rebuild_base' && isKnownOldMemoRebuildPrompt(store.rebuild_default_system_message_template, store.rebuild_default_message_template)) {
            store.rebuild_default_system_message_template = REBUILD_SYSTEM_PROMPT;
            store.rebuild_default_message_template = REBUILD_USER_PROMPT;
        }
        store.step_by_step = false;
        applicationFunctionManager.saveSettingsDebounced?.();
        console.log('[Memo][settings] 七表默认设置已归一化');
    }
} catch (error) {
    console.warn('[Memo][settings] bootstrap normalization failed:', error);
}

export { REBUILD_SYSTEM_PROMPT, REBUILD_USER_PROMPT };
