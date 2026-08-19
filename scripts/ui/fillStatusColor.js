import { EDITOR } from '../../core/manager.js';

// Memo 状态提示：成功提示 2.5 秒，诊断提示 4 秒。
// 只调整指定提示的颜色和显示时长，不修改 API、填表或事件逻辑。
if (!EDITOR.__memoToastPatched) {
    const originalSuccess = EDITOR.success.bind(EDITOR);
    const originalInfo = EDITOR.info.bind(EDITOR);
    const originalWarning = EDITOR.warning.bind(EDITOR);
    const originalError = EDITOR.error.bind(EDITOR);

    EDITOR.success = (message, detail = '', timeout) => {
        const text = String(message ?? '').replace(/[！!]+$/g, '').trim();
        if (text === '独立填表完成') {
            return originalInfo('独立填表完成！', detail, 2500);
        }
        if (text === '填表完成') {
            return originalSuccess('填表完成！', detail, 2500);
        }
        return originalSuccess(message, detail, timeout);
    };

    EDITOR.info = (message, detail = '', timeout) => {
        const text = String(message ?? '').replace(/[！!]+$/g, '').trim();
        if (text === '独立填表完成') {
            return originalInfo('独立填表完成！', detail, 2500);
        }
        return originalInfo(message, detail, timeout);
    };

    EDITOR.warning = (message, detail = '', timeout) => {
        if (String(message ?? '').includes('一次API诊断')) {
            return originalWarning(message, detail, 4000);
        }
        return originalWarning(message, detail, timeout);
    };

    EDITOR.error = (message, detail = '', error, timeout) => {
        if (String(message ?? '').includes('一次API诊断')) {
            return originalError(message, detail, error, 4000);
        }
        return originalError(message, detail, error, timeout);
    };

    EDITOR.__memoToastPatched = true;
}
