import { USER } from '../../core/manager.js';

const TOGGLE_ID = 'memory-independent-record-api';
const PREF_KEY = 'independent_record_api_enabled';
let guardedStore = null;

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
    if (!store) return false;
    if (guardedStore === store) return true;

    // 独立记录 API 开关是 step_by_step 的唯一真值。
    // 如果 loadSettings 替换了整个设置对象，这里会在新对象上重新安装硬锁。
    if (store[PREF_KEY] !== true) store[PREF_KEY] = false;

    try {
        Object.defineProperty(store, 'step_by_step', {
            configurable: true,
            enumerable: true,
            get() {
                return store[PREF_KEY] === true;
            },
            set(value) {
                // 禁止其他代码绕过独立 API 开关直接改变运行模式。
                if ((value === true) !== (store[PREF_KEY] === true)) {
                    console.warn('[Memo] 已拦截外部 step_by_step 写入：', value);
                }
            },
        });
        guardedStore = store;
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
    console.log(`[Memo] 独立记录 API：${value ? '开启（主API + 1次独立API）' : '关闭（仅主API）'}`);
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
        installStepByStepGuard();
        if (mount()) observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => observer.disconnect(), 10000);
}

// 前10秒持续检查“设置对象是否被替换”，只做本地状态同步，不发任何 API。
let guardChecks = 0;
const guardTimer = setInterval(() => {
    guardChecks += 1;
    const previous = guardedStore;
    installStepByStepGuard();
    if (guardedStore !== previous || guardChecks === 1) applyMode(readEnabled(), false);
    if (guardChecks >= 40) clearInterval(guardTimer);
}, 250);

console.log('[Memo] 独立记录 API 硬锁已加载：关闭时 step_by_step 恒为 false');
