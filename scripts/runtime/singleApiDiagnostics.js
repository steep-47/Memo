import { APP, BASE, USER } from '../../core/manager.js';

const STATUS_ID = 'memory-single-api-status';
let beforeHash = '';

function isSingleApiMode() {
    return USER?.tableBaseSetting?.step_by_step !== true;
}

function ensureStatusNode() {
    let node = document.getElementById(STATUS_ID);
    if (node) return node;

    const toggle = document.getElementById('memory-independent-record-api');
    if (!toggle?.parentElement) return null;

    node = document.createElement('div');
    node.id = STATUS_ID;
    node.style.cssText = 'margin:2px 0 8px 26px;font-size:.82em;line-height:1.4;opacity:.72;';
    node.textContent = '单API状态：等待测试';
    toggle.after(node);
    return node;
}

function setStatus(text) {
    const node = ensureStatusNode();
    if (!node) return;
    node.style.display = isSingleApiMode() ? '' : 'none';
    node.textContent = `单API状态：${text}`;
}

function snapshotReferenceHash() {
    try {
        const piece = BASE.getReferencePiece?.();
        return JSON.stringify(piece?.hash_sheets || {});
    } catch (_) {
        return '';
    }
}

function promptContainsMemoWriteProtocol(eventData) {
    const chat = Array.isArray(eventData?.chat) ? eventData.chat : [];
    return chat.some(message => {
        const content = String(message?.content || '');
        return content.includes('# Memo 世界状态记忆') &&
            content.includes('insertRow(') &&
            content.includes('updateRow(') &&
            content.includes('<tableEdit>');
    });
}

function onPromptReady(eventData) {
    if (!isSingleApiMode()) return;
    beforeHash = snapshotReferenceHash();

    // 让原插件 CHAT_COMPLETION_PROMPT_READY 监听器先完成注入，再检查最终请求数组。
    setTimeout(() => {
        if (!isSingleApiMode()) return;
        if (promptContainsMemoWriteProtocol(eventData)) {
            setStatus('写表提示已注入，等待AI回复');
        } else {
            setStatus('本轮未注入写表提示');
        }
    }, 0);
}

function onMessageRendered(chatId) {
    if (!isSingleApiMode()) return;

    const chat = USER.getContext()?.chat?.[chatId];
    const mes = String(chat?.mes || '');
    const hasTag = /<tableEdit>[\s\S]*?<\/tableEdit>/.test(mes);

    if (!hasTag) {
        setStatus('提示已注入，但AI未返回tableEdit');
        return;
    }

    setStatus('AI已返回tableEdit，检查是否写入');

    // 原插件解析/保存完成后再比较本轮表格快照。
    setTimeout(() => {
        try {
            const current = USER.getContext()?.chat?.[chatId];
            const afterHash = JSON.stringify(current?.hash_sheets || {});
            if (afterHash && afterHash !== beforeHash) {
                setStatus('成功：tableEdit已写入表格');
            } else {
                setStatus('故障：AI有tableEdit，但表格未写入');
            }
        } catch (_) {
            setStatus('故障：AI有tableEdit，但无法确认写入结果');
        }
    }, 150);
}

function mountStatusWatcher() {
    ensureStatusNode();
    const observer = new MutationObserver(() => {
        const node = ensureStatusNode();
        if (node) node.style.display = isSingleApiMode() ? '' : 'none';
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
}

APP.eventSource.on(APP.event_types.CHAT_COMPLETION_PROMPT_READY, onPromptReady);
APP.eventSource.on(APP.event_types.CHARACTER_MESSAGE_RENDERED, onMessageRendered);
mountStatusWatcher();

console.log('[Memo] 单API可见诊断已加载');
