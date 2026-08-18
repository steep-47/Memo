import { USER } from '../../core/manager.js';

const TOGGLE_ID = 'memory-independent-record-api';
const INIT_FLAG = 'independent_record_api_initialized';

function getPrimaryStore() {
    const root = USER?.getSettings?.();
    if (!root) return null;
    if (!root.muyoo_dataTable || typeof root.muyoo_dataTable !== 'object') {
        root.muyoo_dataTable = {};
    }
    return root.muyoo_dataTable;
}

function ensureDefaultOffOnce() {
    const store = getPrimaryStore();
    if (!store) return;
    if (store[INIT_FLAG] === true) return;

    // 首次启用本开关逻辑时，明确把主设置写成 false。
    // 这样主设置会覆盖旧 extension_settings 中可能残留的 step_by_step=true。
    store.step_by_step = false;
    store[INIT_FLAG] = true;
    USER.saveSettings?.();
}

function getEnabled() {
    return USER?.tableBaseSetting?.step_by_step === true;
}

function applyMode(enabled, { save = true } = {}) {
    if (!USER?.tableBaseSetting) return;

    USER.tableBaseSetting.step_by_step = !!enabled;

    const fillTime = document.querySelector('#fill_table_time');
    if (fillTime) fillTime.value = enabled ? 'after' : 'chat';

    const replyOptions = document.querySelector('#reply_options');
    const stepOptions = document.querySelector('#step_by_step_options');

    if (replyOptions) replyOptions.style.display = enabled ? 'none' : '';
    if (stepOptions) {
        // 容器始终保留；关闭时只隐藏独立记录专属控件，模板继续显示。
        stepOptions.classList.toggle('memory-independent-record-off', !enabled);
        stepOptions.style.display = '';
    }

    const toggle = document.querySelector(`#${TOGGLE_ID} input[type="checkbox"]`);
    if (toggle) toggle.checked = !!enabled;

    if (save) USER.saveSettings?.();
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

    input.addEventListener('change', () => applyMode(input.checked));
    label.append(input, text, hint);
    return label;
}

function mountToggle() {
    const fillTime = document.querySelector('#fill_table_time');
    if (!fillTime) return false;

    const host = fillTime.parentElement;
    if (!host) return false;

    ensureDefaultOffOnce();

    if (!document.getElementById(TOGGLE_ID)) {
        const toggle = createToggle();
        const runTitle = Array.from(host.querySelectorAll('h4')).find(el =>
            String(el.textContent || '').includes('运行策略')
        );
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

    // 原插件 renderSetting 可能稍后再次修改显示状态；这里只同步 UI，不改用户选择。
    [0, 50, 200, 500, 1000].forEach(delay => {
        setTimeout(() => applyMode(getEnabled(), { save: false }), delay);
    });
}

start();
console.log('[Memo] 独立记录 API 开关已加载（首次默认关闭，之后记忆用户选择）');
