import { APP, USER } from '../../core/manager.js';

const PREF_KEY = 'independent_record_api_enabled';

function getStore() {
    const root = USER?.getSettings?.();
    if (!root) return null;
    if (!root.muyoo_dataTable || typeof root.muyoo_dataTable !== 'object') root.muyoo_dataTable = {};
    return root.muyoo_dataTable;
}

export function isIndependentRecordEnabled() {
    return getStore()?.[PREF_KEY] === true;
}

function syncRuntimeMode() {
    const enabled = isIndependentRecordEnabled();
    if (USER?.tableBaseSetting) USER.tableBaseSetting.step_by_step = enabled;
    return enabled;
}

// 关键：这些监听器必须先于 index.js 的同名监听器注册。
// 关闭独立记录 API 时，在原作者真正分流之前强制恢复普通单 API 模式。
APP.eventSource.on(APP.event_types.CHAT_COMPLETION_PROMPT_READY, () => {
    syncRuntimeMode();
});

APP.eventSource.on(APP.event_types.CHARACTER_MESSAGE_RENDERED, () => {
    syncRuntimeMode();
});

APP.eventSource.on(APP.event_types.MESSAGE_EDITED, () => {
    syncRuntimeMode();
});

syncRuntimeMode();
console.log('[Memo] API 模式桥接已加载：关闭=原作者单API，开启=独立填表');
