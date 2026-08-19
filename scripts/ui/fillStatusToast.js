import { APP, USER } from '../../core/manager.js';

function independentEnabled() {
    const root = USER?.getSettings?.();
    return root?.muyoo_dataTable?.independent_record_api_enabled === true;
}

function patchIndependentToastColor() {
    if (!window.toastr || window.toastr.__memoFillModePatched) return false;
    const originalSuccess = window.toastr.success.bind(window.toastr);
    window.toastr.success = function(message, ...args) {
        const text = String(message ?? '').replace(/[！!]+$/g, '').trim();
        if (text === '独立填表完成') {
            return window.toastr.info('独立填表完成', ...args);
        }
        return originalSuccess(message, ...args);
    };
    window.toastr.__memoFillModePatched = true;
    return true;
}

function ensurePatch() {
    if (patchIndependentToastColor()) return;
    let count = 0;
    const timer = setInterval(() => {
        count += 1;
        if (patchIndependentToastColor() || count >= 40) clearInterval(timer);
    }, 250);
}

ensurePatch();

jQuery(() => {
    APP.eventSource.on(APP.event_types.CHARACTER_MESSAGE_RENDERED, (chatId) => {
        // 只有硬锁判定为单 API，且当前回复真的含有 tableEdit，才显示绿色提示。
        if (independentEnabled()) return;
        if (USER.tableBaseSetting.isExtensionAble === false || USER.tableBaseSetting.isAiWriteTable === false) return;
        const chat = USER.getContext()?.chat?.[chatId];
        if (!chat || chat.is_user === true) return;
        if (!/<tableEdit>[\s\S]*?<\/tableEdit>/.test(String(chat.mes ?? ''))) return;
        setTimeout(() => window.toastr?.success('填表完成'), 100);
    });
});
