import { APP, EDITOR, USER } from '../../core/manager.js';

const PREF_KEY = 'independent_record_api_enabled';

function independentEnabled() {
    return USER?.getSettings?.()?.muyoo_dataTable?.[PREF_KEY] === true;
}

function compact(text, max = 120) {
    return String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function passiveCheck(chatId) {
    if (independentEnabled()) return;
    const chat = USER?.getContext?.()?.chat?.[chatId];
    if (!chat || chat.is_user) return;

    const text = String(chat.mes ?? '');
    // 新的一次API链由singleApiStructured负责schema注入和拆包。
    // 此文件只保留被其他旧代码误加载时的被动诊断，绝不再修改prompt。
    if (text.trim().startsWith('{') && text.includes('"table_edit"') && text.includes('"reply"')) {
        EDITOR.warning(`一次API结构化结果尚未拆包｜开头：${compact(text)}`);
    }
}

APP.eventSource.on(APP.event_types.CHARACTER_MESSAGE_RENDERED, passiveCheck);
console.log('[Memo] 旧一次API诊断已降级为纯被动检查：不再注入tableEdit-first提示');
