import { APP, USER } from '../../core/manager.js';

const PANEL_ID = 'memo-api-diagnostics';
const COPY_ID = 'memo-api-diagnostics-copy';
const CLEAR_ID = 'memo-api-diagnostics-clear';

const state = {
    turn: 0,
    startedAt: '',
    requestCount: 0,
    requestPaths: [],
    promptReadyCount: 0,
    independentCompletionCount: 0,
    stepByStepAtPrompt: null,
    injectionDetected: false,
    injectionRoles: [],
    tableEditDetected: false,
    tableEditActionCount: 0,
    reasoningDetected: false,
    reasoningFields: [],
    renderedMessageId: null,
    model: '',
    endpoint: '',
};

function resetTurn() {
    state.turn += 1;
    state.startedAt = new Date().toLocaleString();
    state.requestCount = 0;
    state.requestPaths = [];
    state.promptReadyCount = 0;
    state.independentCompletionCount = 0;
    state.stepByStepAtPrompt = null;
    state.injectionDetected = false;
    state.injectionRoles = [];
    state.tableEditDetected = false;
    state.tableEditActionCount = 0;
    state.reasoningDetected = false;
    state.reasoningFields = [];
    state.renderedMessageId = null;
    refreshPanel();
}

function getIndependentEnabled() {
    return USER?.getSettings?.()?.muyoo_dataTable?.independent_record_api_enabled === true;
}

function readDomValue(selectors) {
    for (const selector of selectors) {
        const el = document.querySelector(selector);
        if (el && typeof el.value === 'string' && el.value.trim()) return el.value.trim();
    }
    return '';
}

function captureConnectionInfo() {
    state.model = readDomValue([
        '#custom_model_id', '#openai_model', '#model_openai_select', '#custom_api_model',
        'input[placeholder*="模型"]', 'input[name*="model"]', 'select[name*="model"]'
    ]);
    state.endpoint = readDomValue([
        '#custom_api_url_text', '#custom_api_url', '#api_url_text',
        'input[placeholder*="URL"]', 'input[name*="url"]'
    ]);
}

function safePath(input) {
    try {
        const raw = typeof input === 'string' ? input : input?.url;
        if (!raw) return '';
        const url = new URL(raw, location.origin);
        return url.pathname;
    } catch {
        return '';
    }
}

function looksLikeGenerationRequest(path, init) {
    if (!path) return false;
    const method = String(init?.method || 'GET').toUpperCase();
    if (method !== 'POST') return false;
    return /chat\/completions|chat-completions|generate|completion/i.test(path);
}

// 只统计请求次数和 URL path，不读取 headers、API key、cookie，也不保存 request body。
const originalFetch = window.fetch?.bind(window);
if (originalFetch && !window.__memoDiagnosticFetchPatched) {
    window.fetch = async function(input, init) {
        const path = safePath(input);
        if (looksLikeGenerationRequest(path, init)) {
            state.requestCount += 1;
            state.requestPaths.push(path);
            refreshPanel();
        }
        return originalFetch(input, init);
    };
    window.__memoDiagnosticFetchPatched = true;
}

function findReasoningFields(obj) {
    const found = new Set();
    const seen = new WeakSet();
    function walk(value, depth = 0) {
        if (!value || typeof value !== 'object' || depth > 5) return;
        if (seen.has(value)) return;
        seen.add(value);
        for (const [key, child] of Object.entries(value)) {
            if (/reason|thinking|thought/i.test(key)) {
                if ((typeof child === 'string' && child.trim()) || (Array.isArray(child) && child.length) || (child && typeof child === 'object')) {
                    found.add(key);
                }
            }
            if (child && typeof child === 'object') walk(child, depth + 1);
        }
    }
    walk(obj);
    return [...found];
}

function detectReasoningFromDom(chatId) {
    const root = document.querySelector(`.mes[mesid="${chatId}"]`);
    if (!root) return false;
    return !!root.querySelector('[class*="reason"], [class*="thinking"], [class*="thought"]');
}

function diagnosticsText() {
    const mode = getIndependentEnabled() ? '开启（允许第二次独立填表 API）' : '关闭（目标：仅主 API）';
    const paths = state.requestPaths.length ? state.requestPaths.map((p, i) => `${i + 1}. ${p}`).join('\n') : '无';
    const roles = state.injectionRoles.length ? state.injectionRoles.join(', ') : '未检测到';
    const reasoningFields = state.reasoningFields.length ? state.reasoningFields.join(', ') : '未检测到';
    return [
        '【Memo API 诊断】',
        `轮次：${state.turn || 0}`,
        `时间：${state.startedAt || '-'}`,
        `独立记录 API：${mode}`,
        `step_by_step（发请求时）：${state.stepByStepAtPrompt === null ? '未捕获' : state.stepByStepAtPrompt}`,
        `CHAT_COMPLETION_PROMPT_READY：${state.promptReadyCount} 次`,
        `疑似生成网络请求：${state.requestCount} 次`,
        `请求路径：\n${paths}`,
        `Memo 填表提示已注入：${state.injectionDetected ? '是' : '否'}`,
        `提示所在 role：${roles}`,
        `主回复含 <tableEdit>：${state.tableEditDetected ? '是' : '否'}`,
        `检测到表格操作：${state.tableEditActionCount} 条`,
        `reasoning / thinking：${state.reasoningDetected ? '检测到' : '未检测到'}`,
        `reasoning 字段：${reasoningFields}`,
        `独立填表完成事件：${state.independentCompletionCount} 次`,
        `模型（DOM可见值）：${state.model || '未识别'}`,
        `端点（DOM可见值）：${state.endpoint || '未识别'}`,
    ].join('\n');
}

function refreshPanel() {
    const pre = document.querySelector(`#${PANEL_ID} pre`);
    if (pre) pre.textContent = diagnosticsText();
}

function mountPanel() {
    if (document.getElementById(PANEL_ID)) return true;
    const anchor = document.querySelector('#memory-independent-record-api') || document.querySelector('#fill_table_time')?.parentElement;
    if (!anchor?.parentElement) return false;

    const wrap = document.createElement('div');
    wrap.id = PANEL_ID;
    wrap.style.cssText = 'margin:14px 0;padding:12px;border:1px solid rgba(128,128,128,.35);border-radius:8px;';

    const title = document.createElement('div');
    title.style.cssText = 'font-weight:700;margin-bottom:8px;';
    title.textContent = 'API 诊断（临时）';

    const hint = document.createElement('div');
    hint.style.cssText = 'opacity:.7;font-size:.9em;margin-bottom:8px;';
    hint.textContent = '只记录次数、模式和结构信号，不记录 API Key / Authorization / Cookie。';

    const pre = document.createElement('pre');
    pre.style.cssText = 'white-space:pre-wrap;word-break:break-word;font-size:.85em;max-height:320px;overflow:auto;margin:8px 0;';

    const copy = document.createElement('button');
    copy.id = COPY_ID;
    copy.className = 'menu_button';
    copy.textContent = '复制诊断信息';
    copy.addEventListener('click', async () => {
        const text = diagnosticsText();
        try {
            await navigator.clipboard.writeText(text);
            window.toastr?.success?.('诊断信息已复制');
        } catch {
            window.prompt('复制下面的诊断信息：', text);
        }
    });

    const clear = document.createElement('button');
    clear.id = CLEAR_ID;
    clear.className = 'menu_button';
    clear.style.marginLeft = '8px';
    clear.textContent = '清空本轮';
    clear.addEventListener('click', resetTurn);

    wrap.append(title, hint, pre, copy, clear);
    anchor.parentElement.insertBefore(wrap, anchor.nextSibling);
    refreshPanel();
    return true;
}

APP.eventSource.on(APP.event_types.CHAT_COMPLETION_PROMPT_READY, (eventData) => {
    // prompt-ready 代表新一轮主生成即将发送；第一次捕获时重置本轮。
    if (state.promptReadyCount > 0 || state.renderedMessageId !== null) resetTurn();
    else if (!state.startedAt) resetTurn();

    state.promptReadyCount += 1;
    state.stepByStepAtPrompt = USER?.tableBaseSetting?.step_by_step === true;
    captureConnectionInfo();

    const chats = Array.isArray(eventData?.chat) ? eventData.chat : [];
    const hits = chats.filter(m => {
        const text = String(m?.content ?? '');
        return /<tableEdit>|insertRow\(|updateRow\(|deleteRow\(|dataTable 世界状态记忆/i.test(text);
    });
    state.injectionDetected = hits.length > 0;
    state.injectionRoles = [...new Set(hits.map(m => m?.role || 'unknown'))];
    refreshPanel();
});

APP.eventSource.on(APP.event_types.CHARACTER_MESSAGE_RENDERED, (chatId) => {
    const chat = USER?.getContext?.()?.chat?.[chatId];
    if (!chat || chat.is_user === true) return;
    state.renderedMessageId = chatId;
    const mes = String(chat.mes ?? '');
    state.tableEditDetected = /<tableEdit>[\s\S]*?<\/tableEdit>/i.test(mes);
    state.tableEditActionCount = (mes.match(/(?:insertRow|updateRow|deleteRow)\s*\(/g) || []).length;
    const fields = findReasoningFields(chat);
    state.reasoningFields = fields;
    state.reasoningDetected = fields.length > 0 || detectReasoningFromDom(chatId);
    captureConnectionInfo();
    setTimeout(refreshPanel, 120);
});

// 观察原作者的“独立填表完成”Toast，只计数，不改变颜色或内容。
const toastObserver = new MutationObserver((records) => {
    for (const record of records) {
        for (const node of record.addedNodes) {
            const text = String(node?.textContent ?? '');
            if (/独立填表完成/.test(text)) {
                state.independentCompletionCount += 1;
                refreshPanel();
            }
        }
    }
});

function startUi() {
    toastObserver.observe(document.documentElement, { childList: true, subtree: true });
    if (mountPanel()) return;
    const observer = new MutationObserver(() => {
        if (mountPanel()) observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => observer.disconnect(), 15000);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startUi, { once: true });
else startUi();

console.log('[Memo] API 诊断已加载：仅本地观察，不增加 API 请求');
