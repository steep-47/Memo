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
    const store = getStore();
    return store?.[PREF_KEY] === true;
}

function applyMode(enabled, save = true) {
    const value = enabled === true;
    const store = getStore();

    if (store) {
        store[PREF_KEY] = value;
        store.step_by_step = value;
    }
    if (USER?.tableBaseSetting) {
        // 只切换原作者已有的 step_by_step。
        // 不修改 injection_mode、deep、提示词或事件链。
        USER.tableBaseSetting.step_by_step = value;
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
    hint.textContent = '（关闭：原作者单API同步填表；开启：正文后额外调用1次API独立记录）';

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

    // 默认关闭；只有用户明确开启过才进入独立API。
    applyMode(readEnabled(), false);

    // 若用户仍使用原作者下拉框，也与同一个状态同步，避免两个控件互相打架。
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

console.log('[Memo] 独立记录 API 开关已加载：仅映射原作者 step_by_step');
