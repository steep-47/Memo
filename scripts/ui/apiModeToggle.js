import { USER } from '../../core/manager.js';

const TOGGLE_ID = 'memory-independent-record-api';
const DIAG_ID = 'memory-single-api-diagnostic';
const DIAG_EVENT = 'memo-single-api-diagnostic';
const PREF_KEY = 'independent_record_api_enabled';

function getPrimaryStore() {
    const root = USER?.getSettings?.();
    if (!root) return null;
    if (!root.muyoo_dataTable || typeof root.muyoo_dataTable !== 'object') {
        root.muyoo_dataTable = {};
    }
    return root.muyoo_dataTable;
}

function getEnabled() {
    const store = getPrimaryStore();
    if (!store) return false;
    return store[PREF_KEY] === true;
}

function persistPreference(enabled) {
    const store = getPrimaryStore();
    if (!store) return;
    store[PREF_KEY] = !!enabled;
    store.step_by_step = !!enabled;
    USER.saveSettings?.();
}

function setDiagnostic(text) {
    const el = document.getElementById(DIAG_ID);
    if (el) el.textContent = `单API检测：${text}`;
}

function applyMode(enabled, { save = true } = {}) {
    const value = !!enabled;

    if (save) persistPreference(value);
    else if (USER?.tableBaseSetting) USER.tableBaseSetting.step_by_step = value;

    if (USER?.tableBaseSetting) {
        USER.tableBaseSetting.isAiReadTable = true;
        USER.tableBaseSetting.isAiWriteTable = true;
        USER.tableBaseSetting.injection_mode = value ? 'deep_system' : 'injection_off';
        USER.tableBaseSetting.deep = 0;
    }

    const fillTime = document.querySelector('#fill_table_time');
    if (fillTime) fillTime.value = value ? 'after' : 'chat';

    const replyOptions = document.querySelector('#reply_options');
    const stepOptions = document.querySelector('#step_by_step_options');
    if (replyOptions) replyOptions.style.display = value ? 'none' : '';
    if (stepOptions) {
        stepOptions.classList.toggle('memory-independent-record-off', !value);
        stepOptions.style.display = '';
    }

    const toggle = document.querySelector(`#${TOGGLE_ID} input[type="checkbox"]`);
    if (toggle) toggle.checked = value;

    const diag = document.getElementById(DIAG_ID);
    if (diag) diag.style.display = value ? 'none' : '';
}

function createToggle() {
    const wrapper = document.createElement('div');
    wrapper.id = `${TOGGLE_ID}-wrapper`;

    const label = document.createElement('label');
    label.id = TOGGLE_ID;
    label.className = 'checkbox_label range-block justifyLeft';
    label.style.margin = '8px 0';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = getEnabled();

    const text = document.createElement('span');
    text.textContent = '独立记录 API';

    const hint = document.createElement('small');
    hint.className = 'toggle-description justifyLeft';
    hint.textContent = '（关闭：每轮共用 1 次 API；开启：正文后额外调用 1 次 API 单独记录）';

    input.addEventListener('change', () => applyMode(input.checked, { save: true }));
    label.append(input, text, hint);

    const diag = document.createElement('small');
    diag.id = DIAG_ID;
    diag.className = 'toggle-description justifyLeft';
    diag.style.display = getEnabled() ? 'none' : '';
    diag.style.margin = '4px 0 8px 32px';
    diag.textContent = '单API检测：等待下一轮';

    wrapper.append(label, diag);
    return wrapper;
}

function mountToggle() {
    const fillTime = document.querySelector('#fill_table_time');
    if (!fillTime) return false;
    const host = fillTime.parentElement;
    if (!host) return false;

    if (!document.getElementById(TOGGLE_ID)) {
        const toggle = createToggle();
        const runTitle = Array.from(host.querySelectorAll('h4')).find(el => String(el.textContent || '').includes('运行策略'));
        if (runTitle) runTitle.after(toggle);
        else host.insertBefore(toggle, host.firstChild);
    }

    applyMode(getEnabled(), { save: false });
    return true;
}

window.addEventListener(DIAG_EVENT, event => {
    const d = event?.detail || {};
    if (d.stage === 'prompt') {
        setDiagnostic(d.status === 'injected' ? '写表提示已注入，等待回复' : '没有生成写表提示');
        return;
    }
    if (d.stage === 'response') {
        const source = d.source ? ` / ${d.source}` : '';
        if (d.status === 'tableedit-detected') {
            setDiagnostic(`检测到 tableEdit（标签:${d.hasOpenTag ? '有' : '无'} / 指令:${d.hasAction ? '有' : '无'}${source}）`);
        } else {
            setDiagnostic(`未检测到 tableEdit（标签:${d.hasOpenTag ? '有' : '无'} / 指令:${d.hasAction ? '有' : '无'} / 回复长度:${d.length ?? 0}${source}）`);
        }
        return;
    }
    if (d.stage === 'parse' && d.status === 'parse-error') setDiagnostic(`解析报错：${d.message || '未知错误'}`);
});

function start() {
    if (!mountToggle()) {
        const observer = new MutationObserver(() => {
            if (mountToggle()) observer.disconnect();
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });
        setTimeout(() => observer.disconnect(), 10000);
    }

    [0, 50, 200, 500, 1000, 2000].forEach(delay => setTimeout(() => applyMode(getEnabled(), { save: false }), delay));
}

start();
console.log('[Memo] 独立记录 API 开关已加载：单API/独立API使用互斥注入路径');
