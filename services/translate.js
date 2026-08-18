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
- 0 当前状态表【快照型】：只保留一行当前快照。日期/时间/地点/当前场景人物变化时 updateRow；空表时才 insertRow。禁止为过去场景追加行。
- 1 角色状态表【快照型】：只保留一行。修为/灵力/神识/身体状态/灵石/钱财/技能术法/擅长等当前值发生变化时 updateRow；新值覆盖旧值，不保存数值流水。未知项保持原值或留空，禁止猜测。
- 2 背包表【库存型】：核心是“当前持有量”，不是日志。同名且同类型、同状态/品质的物品视为同一库存项；再次获得时优先把数量相加后 updateRow，例如2根+2根→4根。不同品质/状态或单位不一致时不要强行合并。消耗时数量相减并 updateRow；数量归0、明确丢失/送出/耗尽时 deleteRow。新库存项才 insertRow。
- 3 当前任务与约定表【生命周期型】：只保存尚未结束事项。新任务/约定 insertRow；同一事项进度/期限变化 updateRow；一旦完成/失败/取消/失效，直接 deleteRow，不要继续保留“已完成”状态。重大结果可另记历史。
- 4 人物表【实体档案型】：同一人物原则上一行。新重要人物 insertRow；已有人物只 updateRow，把新的修为/身份/关系/长期状态合并进原行，而不是新增版本。当前状态只写具有持续意义的状态，如同行/受伤/失踪/被俘/已离开/下落不明；不要把站在某门口、某店内等一次性位置长期保存。普通路人不要记录。
- 5 历史事件表【事件归档型】：只记录会影响后续的重要既成节点，不做剧情流水账。同一事件链中的连续过程优先 update 已有历史行的事件/结果，只有出现新的重大不可逆节点时才 insertRow。普通见面、问话、短暂对峙、赶路、购物等不要单独成历史。

# 通用判断原则
- 先判断“这张表是什么类型”，再决定 insert/update/delete；禁止把所有表都按追加或简单去重处理。
- 每次独立填表都逐表检查 0→1→2→3→4→5。
- 增加任何新行之前，必须先检查该表是否已有同一对象/同一事项/同一事件链；能 update 或合并就不要 insert。
- “当前”类表只表达现在；“库存”类表表达当前数量；“实体”类表维护同一对象；“历史”类表只保留关键结果。
- 只记录已确认事实；不知道的内容留空，不猜测、不补设定、不回滚既成事实。
- 单元格并列内容使用 / 分隔，避免逗号。
- 如果确实没有任何变化，只输出空的<tableEdit><!-- --></tableEdit>。

# 输出格式示例
<tableEdit>
<!--
updateRow(0, 0, {1:"08:20", 2:"清河镇>街尾"})
updateRow(1, 0, {9:"铜钱82文"})
updateRow(2, 3, {2:"4根"})
deleteRow(3, 0)
updateRow(4, 0, {6:"已离开", 7:"与陈尘发生过重要交集"})
-->
</tableEdit>`;

const STEP_BY_STEP_PROMPT = `[
  { role: 'system', content: '你是世界状态记忆维护器。只维护六张表，不输出正文。先判断表格类型，再决定覆盖、合并、删除、更新或有限追加。必须依据已确认事实，禁止猜测。你的首要任务是维护当前有效状态，而不是不断新增记录。' },
  { role: 'user', content: '<已有表格>\\n$0\\n</已有表格>\\n<最近上下文>\\n$1\\n</最近上下文>\\n<本轮内容>\\n$2\\n</本轮内容>\\n<操作规则>\\n$3\\n</操作规则>\\n逐表检查0到5。0和1是快照型，只覆盖当前值；2是库存型，同名同类型同品质物品再次获得要把数量相加后update，消耗则相减，归0删除；3是生命周期型，事项完成/失败/取消/失效直接delete；4是实体档案型，同一人物更新原行；5是事件归档型，只保留重大节点并优先压缩同一事件链。每次insert之前先扫描已有行。只输出<tableEdit><!-- 函数调用 --></tableEdit>。若无变化输出<tableEdit><!-- --></tableEdit>。' }
]`;

function forceWorldMemoryWriteProtocol() {
    try {
        const settings = applicationFunctionManager.power_user;
        if (!settings.muyoo_dataTable) settings.muyoo_dataTable = {};
        const table = settings.muyoo_dataTable;

        table.message_template = WORLD_MEMORY_PROMPT;
        table.isExtensionAble = true;
        table.isAiReadTable = true;
        table.isAiWriteTable = true;

        table.step_by_step = true;
        table.step_by_step_use_main_api = true;
        table.step_by_step_user_prompt = STEP_BY_STEP_PROMPT;
        table.bool_silent_refresh = true;
        table.separateReadContextLayers = 2;
        table.separateReadLorebook = false;
        table.injection_mode = 'deep_system';
        table.deep = 1;
        table.updateIndex = Math.max(Number(table.updateIndex || 0), 11);

        applicationFunctionManager.saveSettingsDebounced?.();
        console.log('[World Memory][diag] independent table update enabled', {
            enabled: table.isExtensionAble,
            read: table.isAiReadTable,
            write: table.isAiWriteTable,
            step_by_step: table.step_by_step,
            use_main_api: table.step_by_step_use_main_api,
            context_layers: table.separateReadContextLayers,
            updateIndex: table.updateIndex,
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
