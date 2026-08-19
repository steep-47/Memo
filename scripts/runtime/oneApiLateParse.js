import { APP, EDITOR, USER } from '../../core/manager.js';
import { getTableEditTag, handleEditStrInMessage, updateSheetsView } from '../../index.js';

const PREF_KEY = 'independent_record_api_enabled';
const parsedKeys = new WeakMap();
const toastKeys = new WeakMap();

function independentEnabled() {
    return USER?.getSettings?.()?.muyoo_dataTable?.[PREF_KEY] === true;
}

function getMatchKey(chat) {
    const { matches } = getTableEditTag(String(chat?.mes || ''));
    if (!matches.length) return { matches, key: '' };
    return { matches, key: matches.join('\u0001') };
}

function tryLateParse(chatId) {
    // 只服务一次 API；独立 API 开启时完全退出。
    if (independentEnabled()) return true;
    if (USER?.tableBaseSetting?.isExtensionAble === false || USER?.tableBaseSetting?.isAiWriteTable === false) return true;

    const chat = USER?.getContext?.()?.chat?.[chatId];
    if (!chat || chat.is_user === true) return true;

    const { matches, key } = getMatchKey(chat);
    if (!matches.length) return false;

    // 原作者若已经在首次 CHARACTER_MESSAGE_RENDERED 时处理过，不重复执行。
    const originalKey = Array.isArray(chat.tableEditMatches) ? chat.tableEditMatches.join('\u0001') : '';
    const alreadyParsed = originalKey === key || parsedKeys.get(chat) === key;

    if (!alreadyParsed) {
        try {
            handleEditStrInMessage(chat);
            parsedKeys.set(chat, key);
            updateSheetsView(chatId);
            console.log('[Memo] 一次API延迟补查：检测到完整 tableEdit，已补执行。');
        } catch (error) {
            console.error('[Memo] 一次API延迟补查失败', error);
            return false;
        }
    }

    // 主 API 真正产生 tableEdit 后才显示绿色成功提示；每组指令只提示一次。
    if (toastKeys.get(chat) !== key) {
        toastKeys.set(chat, key);
        EDITOR.success('填表完成！');
    }
    return true;
}

function onCharacterMessageRendered(chatId) {
    if (independentEnabled()) return;

    // 中转/流式返回可能在 CHARACTER_MESSAGE_RENDERED 后继续补齐消息尾部。
    // 分阶段复查；一旦找到完整 tableEdit 就停止后续有效处理。
    const delays = [250, 750, 1500, 3000];
    let done = false;
    for (const delay of delays) {
        setTimeout(() => {
            if (done || independentEnabled()) return;
            done = tryLateParse(chatId);
        }, delay);
    }
}

APP.eventSource.on(APP.event_types.CHARACTER_MESSAGE_RENDERED, onCharacterMessageRendered);

console.log('[Memo] 一次API延迟 tableEdit 补查器已加载');
