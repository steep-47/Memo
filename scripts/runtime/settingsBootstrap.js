import { defaultSettings } from '../../data/pluginSetting.js';
import applicationFunctionManager from '../../services/appFuncManager.js';

// Canonical defaults that must exist before index.js renders settings.
defaultSettings.table_cell_width_mode ??= 'wide1_2_cell';

const REBUILD_MARKER = '[Memo六表整理v3]';
const REBUILD_SYSTEM_PROMPT = `${REBUILD_MARKER}\n你是世界状态数据库整理器。你的任务是根据当前六张表与最近聊天，返回六张表整理后的最终状态。不是修改记录，不是旧表+新表拼接。只依据已确认事实，不猜测未知，不模拟NPC离线生活。人物表保存NPC最后有效发展锚点；历史表只保存会影响未来推演的重要既成节点。最终只能输出一个合法JSON数组，不输出Markdown、代码块、tableEdit、解释或前后缀。`;

const REBUILD_USER_PROMPT = `<当前表格>\n$0\n</当前表格>\n<聊天记录>\n$1\n</聊天记录>\n<固定表头>\n$2\n</固定表头>\n\n请输出六张表整理后的最终JSON数组。每个元素仅包含 tableName、tableIndex、columns、content。\n强制规则：\n1. columns必须与固定表头完全一致，禁止改表名、删表、改列名或改列顺序；content只能包含数据行，禁止复制表头。\n2. 当前状态表最多1行，只保留时间线上最新快照。\n3. 角色状态表最多1行，只保存<user>/玩家本人最新状态，禁止混入NPC。\n4. 背包表只保存当前实际持有库存；同一物品合并，已消耗/丢失/归零不输出。\n5. 当前任务与约定表只保存尚未结束事项。\n6. 人物表同一NPC只能一行。姓名/别名/称呼/身份/外貌/事件链共同识别实体。保留并整合已确认的修为、主要能力、身份所属、当前地点、年龄或最后确认时间、重要状态、主要目标/重要事项、与玩家关系。新事实覆盖旧锚点；未知字段留空，不得为了补齐而编造。\n7. 历史事件表只保留会改变未来推演的重要节点，如突破或突破失败、势力加入退出、婚姻或重要亲属变化、重伤残疾/寿元重大损耗、重大机缘、战争或宗门覆灭导致处境改变、死亡。普通修炼和日常流水不保留。\n8. 人物最新状态与历史冲突时，以时间更晚且明确发生的事实为准。\n9. 空表必须输出 content:[]。即使某张表为空，也必须保留该表对象。\n10. 必须返回完整六表数组，不能只返回发生变化的表，也不能返回空数组[]。`;

defaultSettings.rebuild_default_system_message_template = REBUILD_SYSTEM_PROMPT;
defaultSettings.rebuild_default_message_template = REBUILD_USER_PROMPT;

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

function isKnownOldMemoRebuildPrompt(systemPrompt, userPrompt) {
    const system = String(systemPrompt || '');
    const user = String(userPrompt || '');
    if (!system.trim()) return true;
    if (system.includes(REBUILD_MARKER)) return false;
    return (
        system.includes('世界状态数据库整理器') ||
        system.includes('memo-six-table-final-state') ||
        system.includes('返回六张表整理完成后的最终状态') ||
        system.includes("role: 'system'") ||
        (system.trim().startsWith('[') && system.includes('$0') && system.includes('$2')) ||
        (!user.trim() && system.includes('六张表'))
    );
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

        // Upgrade only Memo's own obsolete rebuild_base prompts. Custom templates are untouched.
        if (store.lastSelectedTemplate === 'rebuild_base' && isKnownOldMemoRebuildPrompt(
            store.rebuild_default_system_message_template,
            store.rebuild_default_message_template
        )) {
            store.rebuild_default_system_message_template = REBUILD_SYSTEM_PROMPT;
            store.rebuild_default_message_template = REBUILD_USER_PROMPT;
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

export { REBUILD_SYSTEM_PROMPT, REBUILD_USER_PROMPT };
