import { defaultSettings } from '../../data/pluginSetting.js';
import applicationFunctionManager from '../../services/appFuncManager.js';

// Canonical defaults that must exist before index.js renders settings.
defaultSettings.table_cell_width_mode ??= 'wide1_2_cell';

const REBUILD_SYSTEM_PROMPT = `[
  { role: 'system', content: '你是世界状态数据库整理器。返回六张表整理完成后的最终状态，不是修改记录，也不是旧表与新表拼接。只依据已确认事实，不猜测未知。人物表保存NPC最后有效发展锚点，不模拟NPC离线生活；历史表只保存会影响未来推演的重要既成节点。只输出合法JSON数组。' },
  { role: 'user', content: '<当前表格>\\n$0\\n</当前表格>\\n<聊天记录>\\n$1\\n</聊天记录>\\n<固定表头>\\n$2\\n</固定表头>\\n输出六张表最终状态。强制规则：1.columns必须与固定表头完全一致，禁止改表名/列名/列顺序；content只能包含数据行，禁止复制表头。2.当前状态表最多1行，只保留时间线上最新快照。3.角色状态表最多1行，只保存<user>/玩家本人最新状态，禁止混入NPC。4.背包只保存当前实际持有库存；同一物品合并，已消耗/丢失/归零不输出。5.任务约定只保存尚未结束事项。6.人物表同一NPC只能一行，姓名/别名/称呼/身份/外貌/事件链共同识别实体；保留并整合已确认的修为、主要能力、身份所属、当前地点、年龄或最后确认时间、重要状态、主要目标/重要事项、与玩家关系。新事实覆盖旧锚点，未知字段留空，不得为了补齐而编造。7.历史表只保留会改变未来推演的重要节点，如突破或失败、势力加入退出、婚姻或重要亲属变化、重伤残疾/寿元重大损耗、重大机缘、战争/宗门覆灭导致处境改变、死亡；普通修炼和日常流水不保留。8.人物最新状态与历史冲突时，以时间更晚且明确发生的事实为准。9.空表写content:[]。每项仅含tableName、tableIndex、columns、content。' }
]`;

defaultSettings.rebuild_default_system_message_template = REBUILD_SYSTEM_PROMPT;
defaultSettings.rebuild_default_message_template = '';

// Keep the schema key spelling compatible with the template builder.
if (Array.isArray(defaultSettings.tableStructure)) {
    for (const table of defaultSettings.tableStructure) {
        if (table.tochat === undefined && table.toChat !== undefined) table.tochat = table.toChat;
    }
}

function clone(value) {
    if (value === null || typeof value !== 'object') return value;
    try { return structuredClone(value); }
    catch (_) { return JSON.parse(JSON.stringify(value)); }
}

try {
    const root = applicationFunctionManager.power_user;
    if (root) {
        if (!root.muyoo_dataTable || typeof root.muyoo_dataTable !== 'object') root.muyoo_dataTable = {};
        const store = root.muyoo_dataTable;

        // Fill only missing standard fields. Never overwrite an existing user choice.
        for (const [key, value] of Object.entries(defaultSettings)) {
            if (!(key in store)) store[key] = clone(value);
        }

        // Old Memo builds stored rebuild_base as blank and relied on translate.js to overwrite it.
        // Repair only that obsolete blank state; custom non-empty prompts remain untouched.
        if (store.lastSelectedTemplate === 'rebuild_base' && !String(store.rebuild_default_system_message_template || '').trim()) {
            store.rebuild_default_system_message_template = REBUILD_SYSTEM_PROMPT;
            store.rebuild_default_message_template = '';
        }

        // Old forced translation protocol could persist step_by_step=true. The current single-API
        // architecture owns this flag at runtime; normal resting state is false.
        store.step_by_step = false;

        // Do not lower or raise updateIndex here. Migration version belongs exclusively to loadSettings().
        applicationFunctionManager.saveSettingsDebounced?.();
        console.log('[Memo][settings] defaults normalized before initialization');
    }
} catch (error) {
    console.warn('[Memo][settings] bootstrap normalization failed:', error);
}

export { REBUILD_SYSTEM_PROMPT };
