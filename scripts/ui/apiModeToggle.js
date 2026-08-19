import { USER } from '../../core/manager.js';

const TOGGLE_ID = 'memory-independent-record-api';
const PREF_KEY = 'independent_record_api_enabled';

function getStore() {
    const root = USER?.getSettings?.();
    if (!root) return null;
    if (!root.muyoo_dataTable || typeof root.muyoo_dataTable !== 'object') {
        root.muyoo_dataTable = {};
    }
    return root.muyoo_dataTable;
}

function readEnabled() {
    return getStore()?.[PREF_KEY] === true;
}

function applyMode(enabled, save = true) {
    const value = enabled === true;
    const store = getStore();
    if (!store) return;

    // 这里只保存用户选择并同步原作者设置，不拦截原作者运行链。
    store[PREF_KEY] = value;
    USER.tableBaseSetting.step_by_step = value;

    // 单 API 模式下把原作者表格提示放到聊天最末端（depth 0）。
    // 不改变独立填表请求本身；独立模式仍沿用原作者两步流程。
    if (!value) {
        USER.tableBaseSetting.injection_mode = 'deep_system';
        USER.tableBaseSetting.deep = 0;
    }

    const fillTime = document.querySelector('#fill_table_time');
    if (fillTime) fillTime.value = value ? 'after' : 'chat';

    const replyOptions = document.querySelector('#reply_options');
    const stepOptions = document.querySelector('#step_by_step_options');
    if (replyOptions) replyOptions.style.display = value ? 'none' : '';
    if (stepOptions) stepOptions.style.display = value ? '' : 'none';

    const checkbox = document.querySelector(`#${TOGGLE_ID} input[type="checkbox"]`);
    if (checkbox) checkbox.checked = value;

    if (save) USER.saveSettings?.();
    console.log(`[Memo] 独立记录 API：${value ? '开启（主API + 1次独立API）' : '关闭（仅主API，填表提示 depth=0）'}`);
}

function createToggle() {
    const label = document.createElement('label');
    label.id = TOGGLE_ID;
    label.className = 'checkbox_label range-block justifyLeft';
    label.style.margin = '8px 0';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = readEnabled();

    const text = document.createElement('span');
    text.textContent = '独立记录 API';

    const hint = document.createElement('small');
    hint.className = 'toggle-description justifyLeft';
    hint.textContent = '（关闭：正文与填表共用1次API；开启：正文后额外调用1次API记录）';

    input.addEventListener('change', () => applyMode(input.checked, true));
    label.append(input, text, hint);
    return label;
}

function mount() {
    const fillTime = document.querySelector('#fill_table_time');
    if (!fillTime) return false;

    if (!document.getElementById(TOGGLE_ID)) {
        const host = fillTime.parentElement;
        if (!host) return false;
        host.insertBefore(createToggle(), fillTime.nextSibling);
    }

    applyMode(readEnabled(), false);

    if (!fillTime.dataset.memoModeBound) {
        fillTime.dataset.memoModeBound = '1';
        fillTime.addEventListener('change', () => applyMode(fillTime.value === 'after', true));
    }
    return true;
}

if (!mount()) {
    const observer = new MutationObserver(() => {
        if (mount()) observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => observer.disconnect(), 10000);
}

console.log('[Memo] 独立记录 API 开关已加载');
