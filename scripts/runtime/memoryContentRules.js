import { BASE, USER } from '../../core/manager.js';
import { defaultSettings } from '../../data/pluginSetting.js';

const RULE_MARK = '[角色身份归一规则]';
const PLAYER_COLUMNS = ['姓名','性别','种族','年龄','修为','灵根/体质','灵力','神识','身体状态','灵石','钱财','技能/术法','擅长','其他状态'];
const PERSON_COLUMNS = ['姓名','别名/称呼','性别','身份/所属','修为','外貌特征','性格','与玩家关系','当前状态','重要信息'];

const compactRules = `\n${RULE_MARK}\n- 表1“角色状态表”仅记录<user>/玩家本人，禁止写入任何NPC；NPC一律进入表4“人物表”。\n- 表4“人物表”仅记录NPC，禁止把<user>/玩家本人写入人物表。\n- 性别只记录剧情已明确确认的信息；未明确时留空，不根据姓名、外貌或称呼猜测。\n- 角色状态/人物记录必须先判断是否为同一人物；昵称、外号、道号、职衔、描述性称呼不得因此新建重复角色。\n- NPC首次只有描述性称呼时可暂作姓名；正式名字出现后替换临时姓名。真实昵称、外号、道号、稳定职衔写入“别名/称呼”。\n- 身份证据不足时不要强行合并；确认同一人物后只保留一条主记录。\n- 所有属性统一使用“神识”；“神魂”仅在确实指灵魂/魂魄本体时使用。\n- 未知、没有、未提及的内容一律留空，不写占位词，也不得猜测。\n`;

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
    person.note = 'NPC专属长期人物表，禁止记录<user>/玩家本人；同一NPC一行；性别仅按明确事实记录';
    person.initNode = '只记录后续值得继续引用的NPC；身份未明可暂用描述性称呼作姓名；不得写入<user>/玩家本人';
    person.insertNode = '出现新的重要NPC且表中没有时插入；严格按既定10列表头写入；不得把表头文字作为数据行';
    person.updateNode = '仅更新NPC；姓名/性别/身份所属/修为/关系/状态按最新已确认值更新；别名称呼/外貌/性格/重要信息保留仍有效内容';
    person.deleteNode = '重复NPC行删除并合并信息；若误写<user>/玩家本人则删除；NPC死亡通常更新当前状态而非删除';
}

function patchSettings(settings) {
    if (!settings || typeof settings !== 'object') return;

    // 单 API 模式：主回复同时生成正文与 <tableEdit>，禁止每轮再发起独立填表请求。
    // 手动“更新记忆”仍可显式调用 TableTwoStepSummary("manual") 作为漏记兜底。
    settings.step_by_step = false;
    settings.isAiReadTable = true;
    settings.isAiWriteTable = true;

    fixPlayerSchema(settings);
    fixPersonSchema(settings);
    if ('message_template' in settings) settings.message_template = appendOnce(settings.message_template);
    if ('refresh_system_message_template' in settings) settings.refresh_system_message_template = appendOnce(settings.refresh_system_message_template);
    if ('refresh_user_message_template' in settings) settings.refresh_user_message_template = appendOnce(settings.refresh_user_message_template);
}

function normalized(values) {
    return (values || []).map(value => String(value || '').trim());
}

function migrateSheet(sheet, targetColumns, insertAfterNameColumns) {
    const header = normalized(sheet.getHeader?.() || []);
    if (header.length === targetColumns.length && targetColumns.every((v, i) => header[i] === v)) return false;

    // 只迁移能明确按列名映射的旧结构，绝不靠位置猜数据。
    const targetWithoutNew = targetColumns.filter(col => !insertAfterNameColumns.includes(col));
    if (header.length !== targetWithoutNew.length || !targetWithoutNew.every((v, i) => header[i] === v)) return false;

    const valueSheet = sheet.getContent?.(true);
    if (!Array.isArray(valueSheet) || !valueSheet.length) return false;

    const nameIndex = targetWithoutNew.indexOf('姓名');
    const insertAt = nameIndex + 2; // valueSheet 第0列为内部行号。
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

function migrateLegacySheets() {
    let migrated = false;
    try {
        for (const sheet of BASE.getChatSheets()) {
            if (!sheet) continue;
            if (sheet.name === '角色状态表') {
                migrated = migrateSheet(sheet, PLAYER_COLUMNS, ['性别']) || migrated;
            } else if (sheet.name === '人物表') {
                const header = normalized(sheet.getHeader?.() || []);
                if (!header.includes('别名/称呼')) {
                    // 最老8列：先一次性在姓名后补“别名/称呼、性别”。
                    const old8 = ['姓名','身份/所属','修为','外貌特征','性格','与玩家关系','当前状态','重要信息'];
                    if (header.length === old8.length && old8.every((v, i) => header[i] === v)) {
                        migrated = migrateSheet(sheet, PERSON_COLUMNS, ['别名/称呼','性别']) || migrated;
                        continue;
                    }
                }
                // 已经有别名的9列：只补性别，顺序为 姓名→别名/称呼→性别→身份/所属。
                const old9 = PERSON_COLUMNS.filter(col => col !== '性别');
                if (header.length === old9.length && old9.every((v, i) => header[i] === v)) {
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
        }
        if (migrated) {
            USER.saveChat();
            BASE.refreshContextView?.();
        }
    } catch (error) {
        console.warn('[世界状态记忆表格] 性别字段迁移失败，已停止迁移以保护原数据', error);
    }
}

patchSettings(defaultSettings);
function patchCurrentSettingsAndData() {
    patchSettings(USER?.tableBaseSetting);
    migrateLegacySheets();
}
queueMicrotask(patchCurrentSettingsAndData);
setTimeout(patchCurrentSettingsAndData, 250);
setTimeout(patchCurrentSettingsAndData, 1000);
setTimeout(patchCurrentSettingsAndData, 2000);

console.log('[世界状态记忆表格] 单API写表模式、玩家/NPC职责、性别字段、身份归一、空值与神识规则已加载');
