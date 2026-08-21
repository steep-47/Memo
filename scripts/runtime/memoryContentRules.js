import { APP, BASE, USER } from '../../core/manager.js';
import { defaultSettings } from '../../data/pluginSetting.js';
import { repairMissingColumnsBeforeCleanup } from './tableStructureRepair.js';

const RULE_MARK = '[角色身份归一规则]';
const NPC_ANCHOR_MARK = '[NPC长期发展锚点规则]';
const PLAYER_COLUMNS = ['姓名','性别','种族','年龄','修为','灵根/体质','灵力','神识','身体状态','灵石','钱财','技能/术法','擅长','其他状态'];
const PERSON_BASE_COLUMNS = ['姓名','别名/称呼','性别','身份/所属','修为','外貌特征','性格','与玩家关系','当前状态','重要信息'];
const PERSON_ANCHOR_COLUMNS = ['当前地点','年龄/最后确认时间','主要能力','主要目标/重要事项'];
const PERSON_COLUMNS = [...PERSON_BASE_COLUMNS, ...PERSON_ANCHOR_COLUMNS];

const compactRules = `\n${RULE_MARK}\n- 表1“角色状态表”仅记录<user>/玩家本人，禁止写入任何NPC；NPC一律进入表4“人物表”。\n- 表4“人物表”仅记录NPC，禁止把<user>/玩家本人写入人物表。\n- 性别只记录剧情已明确确认的信息；未明确时留空，不根据姓名、外貌或称呼猜测。\n- 角色状态/人物记录必须先判断是否为同一人物；昵称、外号、道号、职衔、描述性称呼不得因此新建重复角色。\n- NPC首次只有描述性称呼时可暂作姓名；正式名字出现后替换临时姓名。真实昵称、外号、道号、稳定职衔写入“别名/称呼”。\n- 身份证据不足时不要强行合并；确认同一人物后只保留一条主记录。\n- 所有属性统一使用“神识”；“神魂”仅在确实指灵魂/魂魄本体时使用。\n- 未知、没有、未提及的内容一律留空，不写占位词，也不得猜测。\n`;

const npcAnchorRules = `\n${NPC_ANCHOR_MARK}\n- Memo只保存NPC长期发展锚点，不自行模拟离线成长，不为NPC成长额外编造事实或记录流水账。\n- 对值得长期追踪的NPC，表4尽量保存已确认的当前修为、主要能力、身份/所属、当前地点、年龄或最后确认时间、重要状态、主要目标/重要事项、与玩家关系；未知字段留空。\n- NPC再次进入当前剧情时，以人物表该NPC最新状态 + 历史事件表中与其相关的重要节点作为离线发展推演起点。\n- 正文确认新的修为、身份、年龄/时间、地点、状态、目标等后，update原人物行形成新锚点；新锚点取代旧状态，禁止从旧时期重复结算。\n- 表5只记录影响未来推演的重要节点：突破/失败、势力加入退出、婚姻或重要亲属变化、重伤残疾/寿元重大损耗、重大机缘、战争/宗门覆灭导致处境改变、死亡等。普通修炼、日常生活、微小财富变化不记录。\n- 人物状态与历史事件冲突时，以时间更晚且已明确发生的事实为准。\n`;

function replaceMarkedBlock(text, mark, block) {
    const value = String(text || '');
    if (!value.includes(mark)) return value + block;
    const escaped = mark.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return value.replace(new RegExp(`\\n${escaped}[\\s\\S]*?(?=\\n#|\\n\\[[^\\n]+规则\\]|$)`), block.trimEnd());
}

function appendRules(text) {
    return replaceMarkedBlock(replaceMarkedBlock(text, RULE_MARK, compactRules), NPC_ANCHOR_MARK, npcAnchorRules);
}

function getTable(settings, index, name) {
    const tables = settings?.tableStructure;
    if (!Array.isArray(tables)) return null;
    return tables.find(table => Number(table?.tableIndex) === index || table?.tableName === name) || null;
}

function fixPlayerSchema(settings) {
    const role = getTable(settings, 1, '角色状态表');
    if (!role) return;
    role.columns = [...PLAYER_COLUMNS];
    role.note = '<user>/玩家本人专属实时状态表，只允许一行；禁止记录任何NPC；性别仅按明确事实记录';
    role.initNode = '首次得到<user>/玩家本人的明确状态信息时插入；不得为NPC建立本表记录';
    role.insertNode = '仅当表为空且对象明确为<user>/玩家本人时插入；严格按既定14列表头写入；NPC禁止插入';
    role.updateNode = '仅更新<user>/玩家本人；性别/修为/灵力/神识/身体/财物/技能/擅长等变化时更新，当前值覆盖旧值';
    role.deleteNode = '若出现重复玩家状态行只保留最新有效一行；若误写NPC行应删除并改记人物表';
}

function fixPersonSchema(settings) {
    const person = getTable(settings, 4, '人物表');
    if (!person) return;
    person.columns = [...PERSON_COLUMNS];
    person.note = 'NPC专属长期人物表，禁止记录<user>/玩家本人；同一NPC一行；保存最后有效发展锚点，不记录离线流水账；性别仅按明确事实记录';
    person.initNode = '只记录后续值得继续引用的NPC；已确认的修为/能力/身份/地点/年龄或确认时间/状态/目标/关系可作长期锚点；未知留空';
    person.insertNode = '出现新的重要NPC且表中没有时插入；严格按既定14列表头写入；不得为补齐锚点编造未知信息';
    person.updateNode = '仅更新NPC；新确认的修为/能力/身份/地点/年龄或时间/状态/目标/关系覆盖对应旧状态，形成新的发展锚点；别名称呼/外貌/性格/仍有效重要信息保留';
    person.deleteNode = '重复NPC行删除并合并信息；若误写<user>/玩家本人则删除；NPC死亡通常更新当前状态并在历史记录死亡节点而非删除';

    const history = getTable(settings, 5, '历史事件表');
    if (history) {
        history.note = '有限追加的重要历史；用于补充NPC发展锚点，只记录会影响未来推演的既成节点';
        history.initNode = '仅补录真正重要且已确认发生的节点；普通修炼/日常生活/微小财富变化不记录';
        history.insertNode = '突破/突破失败、势力加入退出、婚姻或重要亲属变化、重伤残疾/寿元重大损耗、重大机缘、战争或宗门覆灭导致处境改变、死亡等重要节点才插入';
        history.updateNode = '仅纠正明确错误或补最终结果；人物最新状态与历史冲突时以时间更晚的明确事实为准';
        history.deleteNode = '重复或明确错误的历史行可删除';
    }
}

function patchSettings(settings) {
    if (!settings || typeof settings !== 'object') return;
    fixPlayerSchema(settings);
    fixPersonSchema(settings);
    if ('message_template' in settings) settings.message_template = appendRules(settings.message_template);
    if ('refresh_system_message_template' in settings) settings.refresh_system_message_template = appendRules(settings.refresh_system_message_template);
    if ('refresh_user_message_template' in settings) settings.refresh_user_message_template = appendRules(settings.refresh_user_message_template);
}

function normalized(values) {
    return (values || []).map(value => String(value || '').trim());
}

function migrateSheet(sheet, targetColumns, insertAfterNameColumns) {
    const header = normalized(sheet.getHeader?.() || []);
    if (header.length === targetColumns.length && targetColumns.every((v, i) => header[i] === v)) return false;
    const targetWithoutNew = targetColumns.filter(col => !insertAfterNameColumns.includes(col));
    if (header.length !== targetWithoutNew.length || !targetWithoutNew.every((v, i) => header[i] === v)) return false;
    const valueSheet = sheet.getContent?.(true);
    if (!Array.isArray(valueSheet) || !valueSheet.length) return false;
    const nameIndex = targetWithoutNew.indexOf('姓名');
    const insertAt = nameIndex + 2;
    const migrated = valueSheet.map((row, rowIndex) => {
        const next = Array.isArray(row) ? row.slice() : [];
        insertAfterNameColumns.forEach((column, offset) => next.splice(insertAt + offset, 0, rowIndex === 0 ? column : ''));
        return next;
    });
    sheet.rebuildHashSheetByValueSheet(migrated);
    sheet.markPositionCacheDirty?.();
    sheet.save(undefined, true);
    return true;
}

function appendPersonAnchorColumns(sheet) {
    const header = normalized(sheet.getHeader?.() || []);
    if (header.length === PERSON_COLUMNS.length && PERSON_COLUMNS.every((v, i) => header[i] === v)) return false;
    if (header.length !== PERSON_BASE_COLUMNS.length || !PERSON_BASE_COLUMNS.every((v, i) => header[i] === v)) return false;
    const valueSheet = sheet.getContent?.(true);
    if (!Array.isArray(valueSheet) || !valueSheet.length) return false;
    const migrated = valueSheet.map((row, rowIndex) => {
        const next = Array.isArray(row) ? row.slice() : [];
        PERSON_ANCHOR_COLUMNS.forEach(column => next.push(rowIndex === 0 ? column : ''));
        return next;
    });
    sheet.rebuildHashSheetByValueSheet(migrated);
    sheet.markPositionCacheDirty?.();
    sheet.save(undefined, true);
    return true;
}

function migrateLegacySheets() {
    let migrated = false;
    try {
        for (const sheet of BASE.getChatSheets()) {
            if (!sheet) continue;
            if (sheet.name === '角色状态表') {
                migrated = migrateSheet(sheet, PLAYER_COLUMNS, ['性别']) || migrated;
                continue;
            }
            if (sheet.name !== '人物表') continue;

            let header = normalized(sheet.getHeader?.() || []);
            if (!header.includes('别名/称呼')) {
                const old8 = ['姓名','身份/所属','修为','外貌特征','性格','与玩家关系','当前状态','重要信息'];
                if (header.length === old8.length && old8.every((v, i) => header[i] === v)) {
                    migrated = migrateSheet(sheet, PERSON_BASE_COLUMNS, ['别名/称呼','性别']) || migrated;
                    header = normalized(sheet.getHeader?.() || []);
                }
            }
            if (header.length === 9 && !header.includes('性别')) {
                const old9 = PERSON_BASE_COLUMNS.filter(col => col !== '性别');
                if (old9.every((v, i) => header[i] === v)) {
                    const valueSheet = sheet.getContent?.(true);
                    if (Array.isArray(valueSheet) && valueSheet.length) {
                        const migratedValues = valueSheet.map((row, rowIndex) => {
                            const next = Array.isArray(row) ? row.slice() : [];
                            next.splice(3, 0, rowIndex === 0 ? '性别' : '');
                            return next;
                        });
                        sheet.rebuildHashSheetByValueSheet(migratedValues);
                        sheet.markPositionCacheDirty?.();
                        sheet.save(undefined, true);
                        migrated = true;
                    }
                }
            }
            migrated = appendPersonAnchorColumns(sheet) || migrated;
        }
        if (migrated) {
            USER.saveChat();
            BASE.refreshContextView?.();
        }
    } catch (error) {
        console.warn('[世界状态记忆表格] NPC锚点字段迁移失败，已停止迁移以保护原数据', error);
    }
}

patchSettings(defaultSettings);

function patchCurrentSettingsAndData() {
    patchSettings(USER?.tableBaseSetting);
    migrateLegacySheets();
}

function repairBeforePrompt() {
    // 导入旧预设、手动删列/改表头等都可能发生在插件初始化之后。
    // 每次真正生成聊天提示前再次统一设置与表结构；本地操作，不增加API调用。
    patchCurrentSettingsAndData();
    repairMissingColumnsBeforeCleanup({ notify: false });
}

queueMicrotask(patchCurrentSettingsAndData);
setTimeout(patchCurrentSettingsAndData, 250);
setTimeout(patchCurrentSettingsAndData, 1000);
setTimeout(patchCurrentSettingsAndData, 2000);

const promptEvent = APP.event_types.CHAT_COMPLETION_PROMPT_READY;
APP.eventSource.on(promptEvent, repairBeforePrompt);
if (typeof APP.eventSource.makeFirst === 'function') {
    APP.eventSource.makeFirst(promptEvent, repairBeforePrompt);
}

console.log('[世界状态记忆表格] 玩家/NPC职责、身份归一、NPC长期发展锚点与请求前结构校验已加载');
