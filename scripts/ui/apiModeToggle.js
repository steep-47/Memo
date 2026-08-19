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

function keepConfigSectionsVisible() {
    const replyOptions = document.querySelector('#reply_options');
    const stepOptions = document.querySelector('#step_by_step_options');
    if (replyOptions) replyOptions.style.display = '';
    if (stepOptions) stepOptions.style.display = '';
}

function applyMode(enabled, save = true) {
    const value = enabled === true;
    const store = getStore();
    if (!store) return;

    // 独立记录 API 使用自己的持久化开关；旧 step_by_step 不再作为模式状态保存。
    // 它只会由 modeRuntimeControl 在受控时机短暂借用，常态必须为 false。
    store[PREF_KEY] = value;
    USER.tableBaseSetting.step_by_step = false;

    const checkbox = document.querySelector(`#${TOGGLE_ID} input[type="checkbox"]`);
    if (checkbox) checkbox.checked = value;

    // 独立 API 模式与设置面板显隐彻底解耦：两组配置始终可见。
    keepConfigSectionsVisible();

    if (save) USER.saveSettings?.();
    console.log(`[Memo] 独立记录 API：${value ? '开启（正文正常生成，随后额外1次API记录）' : '关闭（正文与填表共用1次API）'}`);
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

    // 加载时只恢复我们自己的开关；旧 step_by_step 仍保持关闭。
    applyMode(readEnabled(), false);
    keepConfigSectionsVisible();

    // 原作者其他代码若随后再次改显隐，下一帧再恢复一次。
    requestAnimationFrame(keepConfigSectionsVisible);
    setTimeout(keepConfigSectionsVisible, 100);
    setTimeout(keepConfigSectionsVisible, 500);
    return true;
}

if (!mount()) {
    const observer = new MutationObserver(() => {
        if (mount()) observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => observer.disconnect(), 10000);
}

console.log('[Memo] 独立记录 API 开关已加载（与旧 step_by_step 完全解耦）');
