import { USER } from '../../core/manager.js';

const TOGGLE_ID = 'memory-independent-record-api';

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

    if (!document.getElementById(TOGGLE_ID)) {
        const toggle = createToggle();
        const runTitle = Array.from(host.querySelectorAll('h4')).find(el =>
            String(el.textContent || '').includes('运行策略')
        );
        if (runTitle) runTitle.after(toggle);
        else host.insertBefore(toggle, host.firstChild);
    }

    // 默认值由 defaultSettings.step_by_step=false 决定；
    // 之后完全尊重 USER.tableBaseSetting 中已保存的用户选择。
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

    // 原插件 renderSetting 可能稍后再次隐藏 step_by_step_options；
    // 延迟只做 UI 同步，不改用户选择。
    [0, 50, 200, 500, 1000].forEach(delay => {
        setTimeout(() => applyMode(getEnabled(), { save: false }), delay);
    });
}

start();
console.log('[Memo] 独立记录 API 开关已加载（默认关闭，尊重用户保存状态）');
