import { APP, BASE, USER } from '../../core/manager.js';

const EXPECTED = ['当前状态表','角色状态表','背包表','当前任务与约定表','人物表','历史事件表'];
const EXPECTED_SET = new Set(EXPECTED);

function getName(obj) {
    return String(obj?.name || obj?.tableName || obj?.sourceData?.name || '').trim();
}

function dedupeGlobalTemplates() {
    try {
        const settings = USER.getSettings?.();
        const templates = settings?.table_database_templates;
        if (!Array.isArray(templates) || templates.length === 0) return false;

        const lastByName = new Map();
        templates.forEach((template, index) => {
            const name = getName(template);
            if (EXPECTED_SET.has(name)) lastByName.set(name, { template, index });
        });

        const canonical = EXPECTED
            .map(name => lastByName.get(name)?.template)
            .filter(Boolean);
        const extras = templates.filter(template => !EXPECTED_SET.has(getName(template)));
        const next = [...canonical, ...extras];

        if (next.length === templates.length && next.every((item, i) => item === templates[i])) return false;

        settings.table_database_templates = next;
        USER.saveSettings?.();
        console.log('[Memo] 全局六表模板已去重并按0-5重排', canonical.map(getName));
        return true;
    } catch (error) {
        console.error('[Memo] 全局模板去重失败:', error);
        return false;
    }
}

function dedupeContextSheets() {
    try {
        const context = BASE?.sheetsData?.context;
        if (!Array.isArray(context) || context.length === 0) return false;

        // 原始 context 项不保证有顶层 name；必须通过真实 Sheet 实例取得名称。
        const instances = BASE.getChatSheets?.() || [];
        const byUid = new Map(instances.map(sheet => [sheet?.uid, sheet]));
        const lastByName = new Map();

        context.forEach((raw, index) => {
            const sheet = byUid.get(raw?.uid);
            const name = String(sheet?.name || '').trim();
            if (EXPECTED_SET.has(name)) lastByName.set(name, { raw, index, uid: raw?.uid });
        });

        const canonical = EXPECTED
            .map(name => lastByName.get(name)?.raw)
            .filter(Boolean);
        const canonicalUids = new Set(canonical.map(raw => raw?.uid).filter(Boolean));

        const extras = context.filter(raw => {
            const sheet = byUid.get(raw?.uid);
            const name = String(sheet?.name || '').trim();
            return !EXPECTED_SET.has(name);
        });
        const next = [...canonical, ...extras];

        const oldUids = context.map(item => item?.uid).filter(Boolean);
        const nextUids = next.map(item => item?.uid).filter(Boolean);
        const changed = oldUids.length !== nextUids.length || oldUids.some((uid, i) => uid !== nextUids[i]);
        if (!changed) return false;

        BASE.sheetsData.context = next;

        // 只清除六张固定表中被淘汰的重复 UID；自定义表不动。
        const removedExpectedUids = new Set();
        for (const raw of context) {
            const sheet = byUid.get(raw?.uid);
            const name = String(sheet?.name || '').trim();
            if (EXPECTED_SET.has(name) && !canonicalUids.has(raw?.uid)) removedExpectedUids.add(raw?.uid);
        }

        const chat = USER.getContext()?.chat || [];
        for (const piece of chat) {
            if (!piece?.hash_sheets || typeof piece.hash_sheets !== 'object') continue;
            for (const uid of removedExpectedUids) delete piece.hash_sheets[uid];
        }

        USER.saveChat?.();
        BASE.refreshContextView?.();
        console.log('[Memo] 当前聊天六表已去重并按0-5重排', canonical.map(raw => byUid.get(raw?.uid)?.name));
        return true;
    } catch (error) {
        console.error('[Memo] 当前聊天六表去重失败:', error);
        return false;
    }
}

function repairAll() {
    dedupeGlobalTemplates();
    dedupeContextSheets();
}

function scheduleRepair() {
    [0, 100, 350, 900].forEach(delay => setTimeout(repairAll, delay));
}

APP.eventSource.on(APP.event_types.CHAT_CHANGED, scheduleRepair);
scheduleRepair();

console.log('[Memo] 六表模板/注册表唯一性守卫已加载');
