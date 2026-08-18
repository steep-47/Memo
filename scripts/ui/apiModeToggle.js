import { USER } from '../../core/manager.js';

const TOGGLE_ID = 'memory-independent-record-api';

function applyMode(enabled) {
    if (!USER?.tableBaseSetting) return;

    USER.tableBaseSetting.step_by_step = !!enabled;

    // 同步原插件的隐藏运行策略控件，保证现有逻辑只走一条分支。
    const fillTime = document.querySelector('#fill_table_time');
    if (fillTime) fillTime.value = enabled ? 'after' : 'chat';

    const replyOptions = document.querySelector('#reply_options');
    const stepOptions = document.querySelector('#step_by_step_options');
    if (replyOptions) replyOptions.style.display = enabled ? 'none' : '';
    if (stepOptions) stepOptions.style.display = enabled ? '' : 'none';

    USER.saveSettings?.();
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

function mountToggle() {
    if (document.getElementById(TOGGLE_ID)) return true;

    const fillTime = document.querySelector('#fill_table_time');
    if (!fillTime) return false;

    const host = fillTime.parentElement;
    if (!host) return false;

    // 放在原“填表行为发生在”位置前；原下拉框仍由现有 CSS 隐藏。
    const toggle = createToggle();
    const runTitle = Array.from(host.querySelectorAll('h4')).find(el =>
        String(el.textContent || '').includes('运行策略')
    );

    if (runTitle?.nextSibling) runTitle.after(toggle);
    else host.insertBefore(toggle, host.firstChild);

    // 页面首次挂载只同步显示，不改变用户已保存模式。
    applyMode(USER?.tableBaseSetting?.step_by_step === true);
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
console.log('[世界状态记忆表格] 独立记录 API 开关已加载');
