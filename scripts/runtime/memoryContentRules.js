import { USER } from '../../core/manager.js';
import { defaultSettings } from '../../data/pluginSetting.js';

const RULE_MARK = '[角色身份归一规则]';

const compactRules = `\n${RULE_MARK}\n- 角色状态/人物记录必须先判断是否为同一人物；昵称、外号、道号、职衔、描述性称呼不得因此新建重复角色。\n- 姓名使用人物第一个已确认的正式名字或稳定正式称呼。首次出场若只有“灰袍男子/黑衣人/老者”等描述性称呼，可暂作当前姓名用于唯一识别；正式名字或正式称呼出现后，立即将姓名更新为正式称呼，并删除这种临时描述称呼，不永久保留为别名。\n- 真实存在且仍用于称呼该人物的昵称、外号、道号、稳定职衔等写入“别名/称呼”（若当前表有该列）；后续识别这些叫法时必须归并到同一人物。\n- 身份证据不足时不要强行合并不同人物；确认同一人物后只保留一条主记录。\n- 所有属性统一使用“神识”，不得把神识属性写成“神魂”；“神魂”仅在确实指灵魂/魂魄本体时使用。\n- 未知、没有、未提及的内容一律留空，不写“未知/暂无/无/没有/未提及/N/A”等占位词；不得为了填满字段而猜测。\n`;

function appendOnce(text) {
    const value = String(text || '');
    return value.includes(RULE_MARK) ? value : value + compactRules;
}

function patchSettings(settings) {
    if (!settings || typeof settings !== 'object') return;
    if ('message_template' in settings) settings.message_template = appendOnce(settings.message_template);
    if ('refresh_system_message_template' in settings) settings.refresh_system_message_template = appendOnce(settings.refresh_system_message_template);
    if ('refresh_user_message_template' in settings) settings.refresh_user_message_template = appendOnce(settings.refresh_user_message_template);
}

// 新安装/重置后的默认规则。
patchSettings(defaultSettings);

// 已有聊天通常保存了自己的设置；加载完成后同步补入，避免只有新聊天生效。
function patchCurrentSettings() {
    patchSettings(USER?.tableBaseSetting);
}

queueMicrotask(patchCurrentSettings);
setTimeout(patchCurrentSettings, 250);
setTimeout(patchCurrentSettings, 1000);

console.log('[世界状态记忆表格] 角色身份归一、空值与神识术语规则已加载');
