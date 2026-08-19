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

    // 复选框保存值是唯一真值。不要再操作 fill_table_time，避免原作者 UI 模块被隐藏/切换。
    store[PREF_KEY] = value;
    USER.tableBaseSetting.step_by_step = value;

    const checkbox = document.querySelector(`#${TOGGLE_ID} input[type="checkbox"]`);
    if (checkbox) checkbox.checked = value;

    if (save) USER.saveSettings?.();
    console.log(`[Memo] 独立记录 API：${value ? '开启（正文后额外1次API）' : '关闭（仅主API）'}`);
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

    // 加载时按保存的复选框状态同步运行字段，但不触发原作者 UI change。
    applyMode(readEnabled(), false);
    return true;
}

if (!mount()) {
    const observer = new MutationObserver(() => {
        if (mount()) observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => observer.disconnect(), 10000);
}

console.log('[Memo] 独立记录 API 开关已加载（单一真值模式）');
