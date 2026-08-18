import applicationFunctionManager from "./appFuncManager.js";

let _lang = undefined;
let _translations = undefined;

const WORLD_MEMORY_PROMPT = `# dataTable 世界状态记忆
## 用途
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

# 六表规则
- 0 当前状态表：原则上只保留一行。日期/时间/地点/当前场景人物变化时优先 updateRow；空表时 insertRow。
- 1 角色状态表：原则上只保留一行。修为/灵力/神识/身体状态/灵石/钱财/技能术法/擅长等当前值发生变化时 updateRow；旧状态被新状态替代，不追加流水。
- 2 背包表：同一物品只保留一行。新物品 insertRow；数量/状态变化 updateRow；明确失去或数量归零 deleteRow。
- 3 当前任务与约定表：新任务/约定 insertRow；进度/期限/状态变化 updateRow；完成/失败/取消/失效 deleteRow。只有重大结果才另外记入历史。
- 4 人物表：同一人物只保留一行。新重要人物 insertRow；身份/修为/关系/当前状态/重要信息变化 updateRow；普通路人不要长期记录。
- 5 历史事件表：只记录会影响后续的重要既成事件；只在确有重大新事件时 insertRow，普通日常不记录。

# 重要原则
- 每次独立填表都逐表检查 0→1→2→3→4→5。
- 已有同一对象时优先 updateRow，禁止重复 insert。
- 只记录已确认事实；不知道的内容留空，不猜测、不补设定、不回滚既成事实。
- 单元格并列内容使用 / 分隔，避免逗号。
- 如果确实没有任何变化，只输出空的<tableEdit><!-- --></tableEdit>。

# 输出格式示例
<tableEdit>
<!--
updateRow(0, 0, {1:"08:20", 2:"清河镇>街尾"})
updateRow(1, 0, {9:"铜钱82文"})
insertRow(2, {0:"馒头", 1:"食物", 2:"2", 3:"普通", 4:"可食用"})
insertRow(4, {0:"张三", 1:"散修", 2:"炼气三层", 3:"青衣", 4:"谨慎", 5:"陌生", 6:"正在清河镇", 7:"与陈尘首次见面"})
-->
</tableEdit>`;

const STEP_BY_STEP_PROMPT = `[
  { role: 'system', content: '你是世界状态记忆维护器。只维护表格，不输出正文。必须依据已确认事实，禁止猜测。' },
  { role: 'user', content: '<已有表格>\\n$0\\n</已有表格>\\n<最近上下文>\\n$1\\n</最近上下文>\\n<本轮内容>\\n$2\\n</本轮内容>\\n<操作规则>\\n$3\\n</操作规则>\\n请逐表检查0到5。已有对象优先updateRow；新对象才insertRow；失效事项按规则deleteRow。只输出<tableEdit><!-- 函数调用 --></tableEdit>。若无变化输出<tableEdit><!-- --></tableEdit>。' }
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

        // 正文只负责剧情，回复完成后由独立填表链专门维护六张表。
        table.step_by_step = true;
        table.step_by_step_use_main_api = true;
        table.step_by_step_user_prompt = STEP_BY_STEP_PROMPT;
        table.bool_silent_refresh = true;
        table.separateReadContextLayers = 2;
        table.separateReadLorebook = false;
        table.injection_mode = 'deep_system';
        table.deep = 1;
        table.updateIndex = Math.max(Number(table.updateIndex || 0), 9);

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
