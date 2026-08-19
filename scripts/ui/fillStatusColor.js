import { EDITOR } from '../../core/manager.js';

// 仅调整独立填表完成提示的颜色：success(绿色) → info(蓝色)。
// 不修改任何 API、填表或事件逻辑。
if (!EDITOR.__memoIndependentToastPatched) {
    const originalSuccess = EDITOR.success.bind(EDITOR);
    EDITOR.success = (message, ...args) => {
        const text = String(message ?? '').replace(/[！!]+$/g, '').trim();
        if (text === '独立填表完成') {
            return EDITOR.info('独立填表完成！', ...args);
        }
        return originalSuccess(message, ...args);
    };
    EDITOR.__memoIndependentToastPatched = true;
}
