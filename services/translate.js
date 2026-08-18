import applicationFunctionManager from "./appFuncManager.js";

let _lang = undefined;
let _translations = undefined;

const WORLD_MEMORY_PROMPT = `# dataTable 世界状态记忆
## 用途
- 以下表格保存当前世界状态与重要长期记忆，是生成下文的重要参考。
- 每次回复正文完成后，必须检查六张表是否因本轮剧情产生了可确认的变化。
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
- 每轮都必须逐表检查 0→1→2→3→4→5，不能因为已有数据就停止更新。
- 已有同一对象时优先 updateRow，禁止重复 insert。
- 只记录已确认事实；不知道的内容留空，不猜测、不补设定、不回滚既成事实。
- 单元格并列内容使用 / 分隔，避免逗号。
- 只有完全没有任何表格变化时，才可以不输出<tableEdit>。

# 输出格式示例
<tableEdit>
<!--
insertRow(0, {0:"苍玄历12500年03月16日", 1:"14:20", 2:"青石城>悦来客栈", 3:"林川/赵岳"})
insertRow(1, {0:"林川", 1:"人族", 2:"23", 3:"炼气七层", 4:"火灵根", 5:"72/100", 6:"正常", 7:"左臂轻伤", 8:"下品36", 9:"铜钱120文", 10:"火弹术", 11:"近身剑斗", 12:""})
insertRow(2, {0:"回气丹", 1:"丹药", 2:"3", 3:"下品", 4:"恢复灵力"})
updateRow(1, 0, {5:"60/100", 8:"下品35"})
insertRow(4, {0:"赵岳", 1:"青云门外门弟子", 2:"炼气八层", 3:"右眉有疤", 4:"好强/记仇", 5:"敌对", 6:"右肩受伤", 7:"与林川在悦来客栈冲突"})
-->
</tableEdit>`;

function forceWorldMemoryWriteProtocol() {
    try {
        const settings = applicationFunctionManager.power_user;
        if (!settings.muyoo_dataTable) settings.muyoo_dataTable = {};
        const table = settings.muyoo_dataTable;

        table.message_template = WORLD_MEMORY_PROMPT;
        table.isExtensionAble = true;
        table.isAiReadTable = true;
        table.isAiWriteTable = true;

        // 使用原插件最稳定的“正文内直接生成 tableEdit，再由 CHARACTER_MESSAGE_RENDERED 解析”的链路。
        // 不使用独立填表 API，避免本地旧设置把更新送到另一条链路。
        table.step_by_step = false;
        table.injection_mode = 'deep_system';
        table.deep = 1;
        table.updateIndex = Math.max(Number(table.updateIndex || 0), 8);

        applicationFunctionManager.saveSettingsDebounced?.();
        console.log('[World Memory][diag] write protocol synced', {
            enabled: table.isExtensionAble,
            read: table.isAiReadTable,
            write: table.isAiWriteTable,
            step_by_step: table.step_by_step,
            injection_mode: table.injection_mode,
            deep: table.deep,
            updateIndex: table.updateIndex,
            promptLength: table.message_template?.length || 0,
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
