import { USER } from '../../core/manager.js';

const TOGGLE_ID = 'memory-independent-record-api';
const PREF_KEY = 'independent_record_api_enabled';
let guardInstalled = false;

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

function installStepByStepGuard() {
    const store = getStore();
    if (!store || guardInstalled) return false;

    // 独立记录 API 开关是 step_by_step 的唯一真值。
    // 任何原作者控件或其他脚本直接写 step_by_step，都不能绕过这个开关。
    if (store[PREF_KEY] !== true) store[PREF_KEY] = false;

    try {
        Object.defineProperty(store, 'step_by_step', {
            configurable: true,
            enumerable: true,
            get() {
                return store[PREF_KEY] === true;
            },
            set(value) {
                // 不直接接受外部写入；模式只能通过 PREF_KEY / applyMode 切换。
                if ((value === true) !== (store[PREF_KEY] === true)) {
                    console.warn('[Memo] 已拦截外部 step_by_step 写入：', value);
                }
            },
        });
        guardInstalled = true;
        return true;
    } catch (error) {
        console.error('[Memo] 安装独立 API 模式硬锁失败：', error);
        return false;
    }
}

function applyMode(enabled, save = true) {
    const value = enabled === true;
    const store = getStore();
    if (!store) return;

    installStepByStepGuard();
    store[PREF_KEY] = value;

    const fillTime = document.querySelector('#fill_table_time');
    if (fillTime) fillTime.value = value ? 'after' : 'chat';

    const replyOptions = document.querySelector('#reply_options');
    const stepOptions = document.querySelector('#step_by_step_options');
    if (replyOptions) replyOptions.style.display = value ? 'none' : '';
    if (stepOptions) stepOptions.style.display = value ? '' : 'none';

    const checkbox = document.querySelector(`#${TOGGLE_ID} input[type="checkbox"]`);
    if (checkbox) checkbox.checked = value;

    if (save) USER.saveSettings?.();
    console.log(`[Memo] 独立记录 API：${value ? '开启（2次API）' : '关闭（仅主API）'}`);
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
    installStepByStepGuard();

    const fillTime = document.querySelector('#fill_table_time');
    if (!fillTime) return false;

    if (!document.getElementById(TOGGLE_ID)) {
        const host = fillTime.parentElement;
        if (!host) return false;
        host.insertBefore(createToggle(), fillTime.nextSibling);
    }

    // 默认关闭；只有 PREF_KEY 明确为 true 才允许独立 API。
    applyMode(readEnabled(), false);

    // 原作者下拉框仍可使用，但最终也只能通过 applyMode 修改唯一真值。
    if (!fillTime.dataset.memoModeBound) {
        fillTime.dataset.memoModeBound = '1';
        fillTime.addEventListener('change', () => applyMode(fillTime.value === 'after', true));
    }
    return true;
}

installStepByStepGuard();

if (!mount()) {
    const observer = new MutationObserver(() => {
        if (mount()) observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => {
        observer.disconnect();
        // 再确认一次，防止原作者 loadSettings 在较晚时刻写回旧 step_by_step。
        installStepByStepGuard();
        applyMode(readEnabled(), false);
    }, 10000);
}

console.log('[Memo] 独立记录 API 硬锁已加载：step_by_step 只能由该开关决定');
