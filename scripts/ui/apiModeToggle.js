import { USER } from '../../core/manager.js';

const TOGGLE_ID = 'memory-independent-record-api';
const DEFAULT_MIGRATION_KEY = 'memo-independent-record-api-default-v2';

function applyMode(enabled, { save = true } = {}) {
    if (!USER?.tableBaseSetting) return;

    USER.tableBaseSetting.step_by_step = !!enabled;

    // 同步原插件的运行策略值；主逻辑仍只读取 step_by_step 分支。
    const fillTime = document.querySelector('#fill_table_time');
    if (fillTime) fillTime.value = enabled ? 'after' : 'chat';

    const replyOptions = document.querySelector('#reply_options');
    const stepOptions = document.querySelector('#step_by_step_options');

    // 单 API 模式仍要保留 step_by_step_options 容器，因为“模板”折叠区挂在这里。
    // 只隐藏独立记录专属控件，不再把整个容器 display:none。
    if (replyOptions) replyOptions.style.display = enabled ? 'none' : '';
    if (stepOptions) {
        stepOptions.style.display = '';
        stepOptions.classList.toggle('memory-independent-record-off', !enabled);
    }

    if (save) USER.saveSettings?.();
}

function ensureDefaultOffOnce() {
    // 这次升级前，旧的已保存 step_by_step=true 会让新开关首次显示为开启。
    // 仅迁移一次：首次加载新版时强制默认关闭；之后完全尊重用户自己的开关选择。
    try {
        if (localStorage.getItem(DEFAULT_MIGRATION_KEY) === '1') return;
        if (USER?.tableBaseSetting) USER.tableBaseSetting.step_by_step = false;
        localStorage.setItem(DEFAULT_MIGRATION_KEY, '1');
        USER.saveSettings?.();
    } catch (error) {
        // localStorage 不可用时仍以单 API 为安全默认，不影响插件继续运行。
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

function mountToggle() {
    if (document.getElementById(TOGGLE_ID)) return true;

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

    applyMode(USER?.tableBaseSetting?.step_by_step === true, { save: false });
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
console.log('[世界状态记忆表格] 独立记录 API 开关已加载（默认关闭，模板常驻）');
