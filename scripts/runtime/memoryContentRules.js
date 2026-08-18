import { USER } from '../../core/manager.js';
import { defaultSettings } from '../../data/pluginSetting.js';

const RULE_MARK = '[角色身份归一规则]';
const PERSON_COLUMNS = ['姓名','别名/称呼','身份/所属','修为','外貌特征','性格','与玩家关系','当前状态','重要信息'];

const compactRules = `\n${RULE_MARK}\n- 角色状态/人物记录必须先判断是否为同一人物；昵称、外号、道号、职衔、描述性称呼不得因此新建重复角色。\n- 姓名使用人物第一个已确认的正式名字或稳定正式称呼。首次出场若只有“灰袍男子/黑衣人/老者”等描述性称呼，可暂作当前姓名用于唯一识别；正式名字或正式称呼出现后，立即将姓名更新为正式称呼，并删除这种临时描述称呼，不永久保留为别名。\n- 真实存在且仍用于称呼该人物的昵称、外号、道号、稳定职衔等写入“别名/称呼”；后续识别这些叫法时必须归并到同一人物。\n- 身份证据不足时不要强行合并不同人物；确认同一人物后只保留一条主记录。\n- 所有属性统一使用“神识”，不得把神识属性写成“神魂”；“神魂”仅在确实指灵魂/魂魄本体时使用。\n- 未知、没有、未提及的内容一律留空，不写“未知/暂无/无/没有/未提及/N/A”等占位词；不得为了填满字段而猜测。\n`;

function appendOnce(text) {
    const value = String(text || '');
    return value.includes(RULE_MARK) ? value : value + compactRules;
}

function fixPersonSchema(settings) {
    const tables = settings?.tableStructure;
    if (!Array.isArray(tables)) return;
    const person = tables.find(table => Number(table?.tableIndex) === 4 || table?.tableName === '人物表');
    if (!person) return;

    // 从源头固定人物表结构，避免 AI 因缺少“别名/称呼”自行新增表头行，
    // 也避免下一轮再依靠整理程序覆盖修正。
    person.columns = [...PERSON_COLUMNS];
    person.note = '值得长期记忆的NPC；同一人物一行；姓名为正式主称呼，昵称/外号/道号/稳定职衔写入别名/称呼；插件按当前场景与关系自动排序';
    person.initNode = '只记录后续值得继续引用的NPC；身份未明可暂用描述性称呼作姓名';
    person.insertNode = '出现新的重要NPC且表中没有时插入；严格按既定9列表头写入，不得把表头文字作为数据行';
    person.updateNode = '正式姓名出现时替换临时描述性姓名；真实别名写入别名/称呼；身份/修为/关系/状态/重要信息变化时更新原行';
}

function patchSettings(settings) {
    if (!settings || typeof settings !== 'object') return;
    fixPersonSchema(settings);
    if ('message_template' in settings) settings.message_template = appendOnce(settings.message_template);
    if ('refresh_system_message_template' in settings) settings.refresh_system_message_template = appendOnce(settings.refresh_system_message_template);
    if ('refresh_user_message_template' in settings) settings.refresh_user_message_template = appendOnce(settings.refresh_user_message_template);
}

// 新安装/重置后的默认结构与规则。
patchSettings(defaultSettings);

// 已有聊天通常保存自己的设置；加载完成后同步修正结构，确保当前聊天也直接拿到正确表头。
function patchCurrentSettings() {
    patchSettings(USER?.tableBaseSetting);
}

queueMicrotask(patchCurrentSettings);
setTimeout(patchCurrentSettings, 250);
setTimeout(patchCurrentSettings, 1000);

console.log('[世界状态记忆表格] 人物表结构、角色身份归一、空值与神识术语规则已加载');
