import { USER } from '../../core/manager.js';

const TOGGLE_ID = 'memory-independent-record-api';
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
}

function createToggle() {
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
    return label;
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
