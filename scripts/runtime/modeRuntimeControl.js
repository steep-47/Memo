import { APP, USER } from '../../core/manager.js';

const PREF_KEY = 'independent_record_api_enabled';

function readEnabled() {
    const settings = USER?.getSettings?.();
    return settings?.muyoo_dataTable?.[PREF_KEY] === true;
}

function enforceMode() {
    if (!USER?.tableBaseSetting) return;
    USER.tableBaseSetting.step_by_step = readEnabled();
}

const promptEvent = APP.event_types.CHAT_COMPLETION_PROMPT_READY;
const renderedEvent = APP.event_types.CHARACTER_MESSAGE_RENDERED;

APP.eventSource.on(promptEvent, enforceMode);
APP.eventSource.on(renderedEvent, enforceMode);

if (typeof APP.eventSource.makeFirst === 'function') {
    APP.eventSource.makeFirst(promptEvent, enforceMode);
    APP.eventSource.makeFirst(renderedEvent, enforceMode);
}

console.log('[Memo] 独立记录 API 运行时模式保护已加载');
