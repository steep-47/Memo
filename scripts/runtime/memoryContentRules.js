import { USER } from '../../core/manager.js';
import { defaultSettings } from '../../data/pluginSetting.js';

const RULE_MARK = '[角色身份归一规则]';
const PERSON_COLUMNS = ['姓名','别名/称呼','身份/所属','修为','外貌特征','性格','与玩家关系','当前状态','重要信息'];

const compactRules = `\n${RULE_MARK}\n- 表1“角色状态表”仅记录<user>/玩家本人，禁止写入任何NPC；NPC无论重要程度一律进入表4“人物表”。\n- 表4“人物表”仅记录NPC，禁止把<user>/玩家本人写入人物表；NPC的修为记录在人物表“修为”，其他值得长期保留但无独立字段的信息写入“重要信息”。\n- 角色状态/人物记录必须先判断是否为同一人物；昵称、外号、道号、职衔、描述性称呼不得因此新建重复角色。\n- NPC姓名使用第一个已确认的正式名字或稳定正式称呼。首次出场若只有“灰袍男子/黑衣人/老者”等描述性称呼，可暂作当前姓名用于唯一识别；正式名字或正式称呼出现后，立即将姓名更新为正式称呼，并删除这种临时描述称呼，不永久保留为别名。\n- 人物表A类字段（姓名、身份/所属、修为、与玩家关系、当前状态）记录当前有效值，发生明确变化时覆盖旧值。\n- 人物表B类字段（别名/称呼、外貌特征、性格、重要信息）保留仍有效且有长期价值的信息，新事实与旧事实合并；明确失效、错误或被新事实否定的内容才移除。\n- 真实存在且仍用于称呼NPC的昵称、外号、道号、稳定职衔等写入“别名/称呼”；后续识别这些叫法时必须归并到同一人物。\n- 身份证据不足时不要强行合并不同人物；确认同一人物后只保留一条主记录。\n- 所有属性统一使用“神识”，不得把神识属性写成“神魂”；“神魂”仅在确实指灵魂/魂魄本体时使用。\n- 未知、没有、未提及的内容一律留空，不写“未知/暂无/无/没有/未提及/N/A”等占位词；不得为了填满字段而猜测。\n`;

function appendOnce(text) {
    const value = String(text || '');
    if (!value.includes(RULE_MARK)) return value + compactRules;
    return value.replace(/\n\[角色身份归一规则\][\s\S]*?(?=\n#|$)/, compactRules.trimEnd());
}

function getTable(settings, index, name) {
    const tables = settings?.tableStructure;
    if (!Array.isArray(tables)) return null;
    return tables.find(table => Number(table?.tableIndex) === index || table?.tableName === name) || null;
}

function fixPlayerSchema(settings) {
    const role = getTable(settings, 1, '角色状态表');
    if (!role) return;

    role.note = '<user>/玩家本人专属实时状态表，只允许一行；禁止记录任何NPC。修为/灵力/神识/身体/财物/技能等使用最新已确认值';
    role.initNode = '首次得到<user>/玩家本人的明确状态信息时插入；不得为NPC建立本表记录';
    role.insertNode = '仅当表为空且对象明确为<user>/玩家本人时插入；NPC禁止插入';
    role.updateNode = '仅更新<user>/玩家本人；修为/灵力/神识/身体/财物/技能/擅长等变化时更新，当前值覆盖旧值';
    role.deleteNode = '若出现重复玩家状态行只保留最新有效一行；若误写NPC行应删除该NPC行并改记人物表';
}

function fixPersonSchema(settings) {
    const person = getTable(settings, 4, '人物表');
    if (!person) return;

    person.columns = [...PERSON_COLUMNS];
    person.note = 'NPC专属长期人物表，禁止记录<user>/玩家本人；同一NPC一行。A类当前状态字段覆盖更新；B类长期信息字段合并更新';
    person.initNode = '只记录后续值得继续引用的NPC；身份未明可暂用描述性称呼作姓名；不得写入<user>/玩家本人';
    person.insertNode = '出现新的重要NPC且表中没有时插入；严格按既定9列表头写入；<user>/玩家本人禁止插入；不得把表头文字作为数据行';
    person.updateNode = '仅更新NPC。A类：姓名/身份所属/修为/与玩家关系/当前状态按最新已确认值覆盖；B类：别名称呼/外貌特征/性格/重要信息合并仍有效内容；正式姓名出现时替换临时描述性姓名';
    person.deleteNode = '重复NPC行删除并合并信息；若误写<user>/玩家本人则删除该人物行；NPC死亡通常更新当前状态而非删除';
}

function patchSettings(settings) {
    if (!settings || typeof settings !== 'object') return;
    fixPlayerSchema(settings);
    fixPersonSchema(settings);
    if ('message_template' in settings) settings.message_template = appendOnce(settings.message_template);
    if ('refresh_system_message_template' in settings) settings.refresh_system_message_template = appendOnce(settings.refresh_system_message_template);
    if ('refresh_user_message_template' in settings) settings.refresh_user_message_template = appendOnce(settings.refresh_user_message_template);
}

// 默认设置与当前聊天同时修正，避免只有新聊天生效。
patchSettings(defaultSettings);

function patchCurrentSettings() {
    patchSettings(USER?.tableBaseSetting);
}

queueMicrotask(patchCurrentSettings);
setTimeout(patchCurrentSettings, 250);
setTimeout(patchCurrentSettings, 1000);

console.log('[世界状态记忆表格] 玩家/NPC表职责锁定、人物表A/B、身份归一、空值与神识规则已加载');
