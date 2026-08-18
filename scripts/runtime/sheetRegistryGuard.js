import { APP, BASE, USER } from '../../core/manager.js';

const EXPECTED = ['当前状态表','角色状态表','背包表','当前任务与约定表','人物表','历史事件表'];

function pickCanonical(entries, name) {
    const matches = entries.filter(item => item?.name === name);
    if (!matches.length) return null;
    // 重复项通常来自旧版本/重复初始化；保留最后创建/最后写入的那一份。
    return matches[matches.length - 1];
}

function dedupeContextSheets() {
    try {
        const context = BASE?.sheetsData?.context;
        if (!Array.isArray(context) || context.length === 0) return false;

        const canonical = EXPECTED.map(name => pickCanonical(context, name)).filter(Boolean);
        const expectedSet = new Set(EXPECTED);
        const extras = context.filter(item => item?.name && !expectedSet.has(item.name));
        const next = [...canonical, ...extras];

        const oldUids = context.map(item => item?.uid).filter(Boolean);
        const nextUids = next.map(item => item?.uid).filter(Boolean);
        const changed = oldUids.length !== nextUids.length || oldUids.some((uid, i) => uid !== nextUids[i]);
        if (!changed) return false;

        BASE.sheetsData.context = next;

        // 清掉聊天消息中已被淘汰的重复 sheet uid，避免后续历史快照再次把重复项带回来。
        const keep = new Set(nextUids);
        const chat = USER.getContext()?.chat || [];
        for (const piece of chat) {
            if (!piece?.hash_sheets || typeof piece.hash_sheets !== 'object') continue;
            for (const uid of Object.keys(piece.hash_sheets)) {
                if (!keep.has(uid)) delete piece.hash_sheets[uid];
            }
        }

        USER.saveChat?.();
        BASE.refreshContextView?.();
        console.log('[Memo] 六表注册表已去重并按0-5重排', next.map(x => x.name));
        return true;
    } catch (error) {
        console.error('[Memo] 六表注册表去重失败:', error);
        return false;
    }
}

function scheduleDedupe() {
    [0, 80, 250, 700].forEach(delay => setTimeout(dedupeContextSheets, delay));
}

APP.eventSource.on(APP.event_types.CHAT_CHANGED, scheduleDedupe);
scheduleDedupe();

console.log('[Memo] 六表唯一性守卫已加载');
