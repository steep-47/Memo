import { USER } from '../../core/manager.js';

const TOGGLE_ID = 'memory-independent-record-api';
const DEFAULT_MIGRATION_KEY = 'memo-independent-record-api-default-v3';

function applyMode(enabled, { save = true } = {}) {
    if (!USER?.tableBaseSetting) return;

    USER.tableBaseSetting.step_by_step = !!enabled;

    // 同步原插件的运行策略值；实际请求分支仍由 step_by_step 控制。
    const fillTime = document.querySelector('#fill_table_time');
    if (fillTime) fillTime.value = enabled ? 'after' : 'chat';

    const replyOptions = document.querySelector('#reply_options');
    const stepOptions = document.querySelector('#step_by_step_options');

    if (replyOptions) replyOptions.style.display = enabled ? 'none' : '';
    if (stepOptions) {
        // 容器始终保留，关闭时只隐藏独立记录专属控件，模板继续显示。
        stepOptions.classList.toggle('memory-independent-record-off', !enabled);
        stepOptions.style.display = '';
    }

    if (save) USER.saveSettings?.();
}

function ensureDefaultOffOnce() {
    // v3 一次性迁移：覆盖此前旧版遗留的 step_by_step=true。
    // 迁移完成后不再干涉用户后续主动选择。
    try {
        if (localStorage.getItem(DEFAULT_MIGRATION_KEY) === '1') return;
        if (USER?.tableBaseSetting) USER.tableBaseSetting.step_by_step = false;
        localStorage.setItem(DEFAULT_MIGRATION_KEY, '1');
        USER.saveSettings?.();
    } catch (error) {
        if (USER?.tableBaseSetting) USER.tableBaseSetting.step_by_step = false;
    }
}

function createToggle() {
    const label = document.createElement('label');
    label.id = TOGGLE_ID;
    label.className = 'checkbox_label range-block justifyLeft';
    label.style.margin = '8px 0';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = USER?.tableBaseSetting?.step_by_step === true;

    const text = document.createElement('span');
    text.textContent = '独立记录 API';

    const hint = document.createElement('small');
    hint.className = 'toggle-description justifyLeft';
    hint.textContent = '（关闭：每轮共用 1 次 API；开启：正文后额外调用 1 次 API 单独记录）';

    input.addEventListener('change', () => applyMode(input.checked));
    label.append(input, text, hint);
    return label;
}

function syncToggleFromSettings() {
    const toggle = document.querySelector(`#${TOGGLE_ID} input[type="checkbox"]`);
    const enabled = USER?.tableBaseSetting?.step_by_step === true;
    if (toggle) toggle.checked = enabled;
    applyMode(enabled, { save: false });
}

function mountToggle() {
    if (document.getElementById(TOGGLE_ID)) {
        syncToggleFromSettings();
        return true;
    }

    const fillTime = document.querySelector('#fill_table_time');
    if (!fillTime) return false;

    const host = fillTime.parentElement;
    if (!host) return false;

    ensureDefaultOffOnce();

    const toggle = createToggle();
    const runTitle = Array.from(host.querySelectorAll('h4')).find(el =>
        String(el.textContent || '').includes('运行策略')
    );

    if (runTitle) runTitle.after(toggle);
    else host.insertBefore(toggle, host.firstChild);

    syncToggleFromSettings();

    // 原插件 renderSetting 可能在本模块之后再次执行 .toggle()。
    // 延迟复核几次，CSS 同时负责兜底，保证首次打开设置时模板即可见。
    [0, 50, 200, 500, 1000].forEach(delay => {
        setTimeout(syncToggleFromSettings, delay);
    });

    return true;
}

function start() {
    if (mountToggle()) return;

    const observer = new MutationObserver(() => {
        if (mountToggle()) observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => observer.disconnect(), 10000);
}

start();
console.log('[世界状态记忆表格] 独立记录 API 开关已加载（默认关闭，模板首次即显示）');
