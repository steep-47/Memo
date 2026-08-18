import applicationFunctionManager from "./appFuncManager.js";

let _lang = undefined;
let _translations = undefined;

const WORLD_MEMORY_PROMPT = `# dataTable 世界状态记忆
## 用途
- 以下六张表不是同一种数据库：必须根据表格语义分别采用覆盖、合并、删除、更新或有限追加。
- 以下表格保存当前世界状态与重要长期记忆，是生成下文的重要参考。
- 表名格式：[tableIndex:表名]；列名格式：[colIndex:列名]；行号格式：[rowIndex]。

{{tableData}}

# 增删改 dataTable 操作方法
如需修改，必须在<tableEdit>标签中使用 JavaScript 函数写法，并且函数必须放在<!-- -->注释中。

## 操作规则
<OperateRule>
insertRow(tableIndex:number, data:{[colIndex:number]:string|number})
deleteRow(tableIndex:number, rowIndex:number)
updateRow(tableIndex:number, rowIndex:number, data:{[colIndex:number]:string|number})
</OperateRule>

# 六表类型与规则
- 0 当前状态表【快照型】：只保留一行当前快照。
- 1 角色状态表【快照型】：只保留一行；当前值覆盖旧值，未知不猜测。
- 2 背包表【库存型】：同名同类型同品质库存合并数量；消耗相减；归0删除。
- 3 当前任务与约定表【生命周期型】：只保存未结束事项；完成/失败/取消/失效删除。
- 4 人物表【实体档案型】：同一人物一行；姓名、别名/称呼、身份、外貌、关系和事件链共同识别实体，称呼变化不等于新人物。
- 5 历史事件表【事件归档型】：只保留影响后续的重要既成节点，同一事件链优先压缩。

# 通用判断原则
- 先判断表格类型，再决定 insert/update/delete。
- 新增前先检查已有对象；能 update/合并就不要 insert。
- 只记录已确认事实，不猜测、不补设定。
- 单元格并列内容使用 / 分隔。
- 无变化输出<tableEdit><!-- --></tableEdit>。`;

const STEP_BY_STEP_PROMPT = `[
  { role: 'system', content: '你是世界状态记忆维护器。只维护六张表，不输出正文。按表格语义维护当前有效状态。人物是实体，不是名字字符串；别名、昵称、外号、职位称呼变化不能自动视为新角色。只依据已确认事实。' },
  { role: 'user', content: '<已有表格>\\n$0\\n</已有表格>\\n<最近上下文>\\n$1\\n</最近上下文>\\n<本轮内容>\\n$2\\n</本轮内容>\\n<操作规则>\\n$3\\n</操作规则>\\n逐表检查0到5：0/1覆盖当前快照；2维护当前库存并合并数量；3维护未结束事项；4维护人物实体与别名；5只归档重大事件并压缩同一事件链。每次insert前先扫描已有行。只输出<tableEdit><!-- 函数调用 --></tableEdit>。' }
]`;

// 表格整理输出的是“最终表内容”，不是旧表+新表，也不是表格文本。
const REBUILD_PROMPT = `[
  { role: 'system', content: '你是世界状态数据库整理器。你必须返回六张表整理完成后的最终状态。注意：这是替换结果，不是追加结果。当前表格只是整理素材，绝不能原样复制旧行后再追加新行。columns 是表头，content 只能包含数据行，严禁把 columns/表头再放进 content。只输出一个合法 JSON 数组，不输出 markdown、代码块、XML标签、<新的表格>、<tableEdit>、说明或任何前后缀。' },
  { role: 'user', content: '<当前表格JSON>\\n$0\\n</当前表格JSON>\\n<聊天记录>\\n$1\\n</聊天记录>\\n<固定表头>\\n$2\\n</固定表头>\\n\\n请重新计算并输出六张表的【最终状态】，不是修改记录，也不是旧表与新表的拼接。强制规则：①每张表的 columns 必须与当前表头完全相同；②content 中不得出现任何一行与 columns 相同或类似的表头文字；③0当前状态表 content 最多1行，只取时间线上最新状态，旧状态行必须丢弃；④1角色状态表 content 最多1行，只取角色当前最新状态，旧状态行必须丢弃；⑤2背包只输出此刻实际持有库存，同物品同类型同品质合并数量，已消耗/丢失/归0不输出；⑥3任务约定只输出尚未结束事项；⑦4人物按实体合并，姓名/别名/称呼变化不能形成重复人物；⑧5历史只输出整理后的重要事件，同一事件链压缩，重复和流水过程不输出；⑨空表必须写 content:[]，绝不能为了占位把列名复制成一条数据；⑩不得创造新表、删表、改表名、改列名或改列顺序。输出数组每项仅含 tableName、tableIndex、columns、content。再次确认：content=最终数据行，绝不是[旧数据行+表头行+新数据行]。' }
]`;

function ensureCharacterAliasColumn(table) {
    try {
        if (!Array.isArray(table.tableStructure)) return false;
        const person = table.tableStructure.find(t => t?.tableName === '人物表' || t?.tableIndex === 4);
        if (!person || !Array.isArray(person.columns)) return false;
        if (person.columns.includes('别名/称呼')) return false;
        const nameIndex = person.columns.indexOf('姓名');
        const insertAt = nameIndex >= 0 ? nameIndex + 1 : 1;
        person.columns.splice(insertAt, 0, '别名/称呼');
        person.note = '值得长期记忆的NPC；同一人物一行；姓名/别名/称呼共同用于识别同一实体';
        person.insertNode = '新增前先检查姓名/别名/身份/外貌/事件链，确认不是已有实体才插入';
        person.updateNode = '同一实体出现新姓名/昵称/外号/称呼时更新原行并补入别名；身份/修为/关系/状态/重要信息变化时更新';
        return true;
    } catch (error) {
        console.warn('[World Memory][schema] 人物别名列设置迁移失败:', error);
        return false;
    }
}

function forceWorldMemoryWriteProtocol() {
    try {
        const settings = applicationFunctionManager.power_user;
        if (!settings.muyoo_dataTable) settings.muyoo_dataTable = {};
        const table = settings.muyoo_dataTable;

        table.message_template = WORLD_MEMORY_PROMPT;
        table.isExtensionAble = true;
        table.isAiReadTable = true;
        table.isAiWriteTable = true;
        const schemaChanged = ensureCharacterAliasColumn(table);

        table.step_by_step = true;
        table.step_by_step_use_main_api = true;
        table.step_by_step_user_prompt = STEP_BY_STEP_PROMPT;
        table.bool_silent_refresh = true;
        table.separateReadContextLayers = 2;
        table.separateReadLorebook = false;
        table.injection_mode = 'deep_system';
        table.deep = 1;

        table.rebuild_default_system_message_template = REBUILD_PROMPT;
        table.rebuild_default_message_template = '';
        table.lastSelectedTemplate = 'rebuild_base';
        table.updateIndex = Math.max(Number(table.updateIndex || 0), 14);

        applicationFunctionManager.saveSettingsDebounced?.();
        console.log('[World Memory][diag] protocol synced', {
            enabled: table.isExtensionAble,
            step_by_step: table.step_by_step,
            updateIndex: table.updateIndex,
            rebuild_template: 'memo-six-table-final-state-v2',
            character_alias_schema: schemaChanged ? 'migrated' : 'ready',
        });
    } catch (error) {
        console.warn('[World Memory][diag] protocol sync failed:', error);
    }
}

async function fetchTranslations(locale) {
    try {
        const response = await fetch(`/scripts/extensions/third-party/Memo/assets/locales/${locale}.json`);
        if (!response.ok) {
            console.warn(`Could not load translations for ${locale}, falling back to zh-cn`);
            if (locale !== 'zh-cn') return await fetchTranslations('zh-cn');
            return {};
        }
        return await response.json();
    } catch (error) {
        console.error('Error loading translations:', error);
        return {};
    }
}

async function getTranslationsConfig() {
    if (_lang === undefined) _lang = applicationFunctionManager.getCurrentLocale();
    if (_lang === undefined) {
        _lang = 'zh-cn';
        return { translations: {}, lang: _lang };
    }
    if (_translations === undefined) _translations = await fetchTranslations(_lang);
    return { translations: _translations, lang: _lang };
}

function applyTranslations(translations) {
    document.querySelectorAll('[data-i18n]').forEach(element => {
        const key = element.getAttribute('data-i18n');
        if (translations[key]) {
            if (element.hasAttribute('title')) element.setAttribute('title', translations[key]);
            else element.textContent = translations[key];
        }
    });
    translateElementsBySelector(translations, '#table_clear_up a', 'Reorganize tables now');
    translateElementsBySelector(translations, '#dataTable_to_chat_button a', 'Edit style of tables rendered in conversation');
}

function translateElementsBySelector(translations, selector, key) {
    if (!translations[key]) return;
    document.querySelectorAll(selector).forEach(element => element.textContent = translations[key]);
}

export async function translating(targetScope, source) {
    let { translations, lang } = await getTranslationsConfig();
    if (lang === 'zh-cn') return source;
    translations = translations[targetScope];
    if (!translations || Object.keys(translations).length === 0) return source;
    function translateRecursively(obj) {
        if (typeof obj === 'string') return translations[obj] || obj;
        if (Array.isArray(obj)) return obj.map(item => translateRecursively(item));
        if (obj !== null && typeof obj === 'object') {
            const result = {};
            for (const key in obj) if (Object.prototype.hasOwnProperty.call(obj, key)) result[key] = translateRecursively(obj[key]);
            return result;
        }
        return obj;
    }
    return source !== null && typeof source === 'object' ? translateRecursively(source) : source;
}

export async function switchLanguage(targetScope, source) {
    const { translations, lang } = await getTranslationsConfig();
    if (lang === 'zh-cn') return source;
    return {...source, ...translations[targetScope] || {}};
}

export async function executeTranslation() {
    forceWorldMemoryWriteProtocol();
    const { translations, lang } = await getTranslationsConfig();
    if (lang === 'zh-cn') return;
    if (Object.keys(translations).length === 0) return;
    applyTranslations(translations);
}
