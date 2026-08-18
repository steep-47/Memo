import { USER } from '../../core/manager.js';

const TOGGLE_ID = 'memory-independent-record-api';
const MODE_MIGRATION_VERSION = 7;

function getEnabled() {
    return USER?.tableBaseSetting?.step_by_step === true;
}

function ensureDefaultOffByConfigVersion() {
    const settings = USER?.tableBaseSetting;
    if (!settings) return;

    const version = Number(settings.updateIndex || 0);
    if (version >= MODE_MIGRATION_VERSION) return;

    // v7 仅迁移一次：旧版本遗留的独立记录状态统一回到默认关闭。
    // 迁移后 updateIndex=7，之后完全尊重用户自己的开关选择。
    settings.step_by_step = false;
    settings.updateIndex = MODE_MIGRATION_VERSION;
    USER.saveSettings?.();
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

    ensureDefaultOffByConfigVersion();

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

    // 原插件 renderSetting 可能稍后再次写 display:none；这里只重新同步 UI，不改保存值。
    [0, 50, 200, 500, 1000].forEach(delay => {
        setTimeout(() => applyMode(getEnabled(), { save: false }), delay);
    });
}

start();
console.log('[Memo] 独立记录 API 开关已加载（v7 默认关闭，之后记忆用户选择）');
