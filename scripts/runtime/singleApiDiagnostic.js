import { APP, EDITOR, USER } from '../../core/manager.js';
import { getTableEditTag, initTableData } from '../../index.js';

const PREF_KEY = 'independent_record_api_enabled';
let lastDiag = null;

function independentEnabled() {
    return USER?.getSettings?.()?.muyoo_dataTable?.[PREF_KEY] === true;
}

function isMemoPrompt(content) {
    const text = String(content ?? '');
    return text.includes('# dataTable 世界状态记忆') ||
        (text.includes('<tableEdit>') && text.includes('insertRow('));
}

function getRole() {
    switch (USER.tableBaseSetting.injection_mode) {
        case 'deep_user': return 'user';
        case 'deep_assistant': return 'assistant';
        case 'deep_system':
        default: return 'system';
    }
}

function inspectAndFallback(eventData) {
    if (independentEnabled()) {
        lastDiag = null;
        return;
    }
    if (eventData?.dryRun === true ||
        USER.tableBaseSetting.isExtensionAble === false ||
        USER.tableBaseSetting.isAiReadTable === false ||
        USER.tableBaseSetting.injection_mode === 'injection_off') {
        lastDiag = null;
        return;
    }

    const chat = Array.isArray(eventData?.chat) ? eventData.chat : [];
    let hitIndex = chat.findLastIndex?.(m => isMemoPrompt(m?.content)) ?? -1;
    if (hitIndex < 0) {
        for (let i = chat.length - 1; i >= 0; i--) {
            if (isMemoPrompt(chat[i]?.content)) {
                hitIndex = i;
                break;
            }
        }
    }

    let fallbackInjected = false;
    if (hitIndex < 0) {
        try {
            const promptContent = initTableData(eventData);
            if (promptContent && promptContent.trim()) {
                const message = { role: getRole(), content: promptContent };
                const deep = Number(USER.tableBaseSetting.deep) || 0;
                if (deep <= 0 || deep >= chat.length) chat.push(message);
                else chat.splice(-deep, 0, message);
                hitIndex = deep <= 0 || deep >= chat.length ? chat.length - 1 : Math.max(0, chat.length - deep - 1);
                fallbackInjected = true;
                console.warn('[Memo诊断] 原作者注入缺失，已在最终请求阶段补入 Memo 提示');
            }
        } catch (error) {
            console.error('[Memo诊断] 最终请求 fallback 注入失败', error);
        }
    }

    const hit = hitIndex >= 0 ? chat[hitIndex] : null;
    lastDiag = {
        promptFound: !!hit,
        fallbackInjected,
        promptIndex: hitIndex,
        promptRole: hit?.role ?? '',
        chatLength: chat.length,
        promptTail: hit ? String(hit.content ?? '').slice(-600) : '',
        capturedAt: Date.now(),
    };

    globalThis.__memoSingleApiDiag = lastDiag;
    console.log('[Memo诊断] 一次API最终请求提示检查', lastDiag);
}

function inspectResponse(chatId) {
    if (independentEnabled()) return;
    const chat = USER?.getContext?.()?.chat?.[chatId];
    if (!chat || chat.is_user === true) return;

    const mes = String(chat.mes ?? '');
    const { matches } = getTableEditTag(mes);
    const joined = matches?.join('\n') ?? '';
    const hasTableEdit = Array.isArray(matches) && matches.length > 0;
    const hasExecutableCode = /(?:insertRow|updateRow|deleteRow)\s*\(/.test(joined);
    const hasNoChange = /NO_CHANGE/.test(joined);

    const diag = {
        ...(lastDiag || {}),
        responseHasTableEdit: hasTableEdit,
        responseHasExecutableCode: hasExecutableCode,
        responseHasNoChange: hasNoChange,
        responseTail: mes.slice(-600),
        responseAt: Date.now(),
    };
    globalThis.__memoSingleApiDiag = diag;
    console.log('[Memo诊断] 一次API最终回复检查', diag);

    if (hasExecutableCode || hasNoChange) return;

    if (lastDiag?.promptFound) {
        EDITOR.warning(lastDiag.fallbackInjected
            ? '一次API诊断：已补入Memo提示，但模型未完成tableEdit收尾'
            : '一次API诊断：提示已注入，但模型未完成tableEdit收尾');
    } else {
        EDITOR.error('一次API诊断：Memo提示补入失败');
    }
}

const promptEvent = APP.event_types.CHAT_COMPLETION_PROMPT_READY;
APP.eventSource.on(promptEvent, inspectAndFallback);
if (typeof APP.eventSource.makeLast === 'function') {
    APP.eventSource.makeLast(promptEvent, inspectAndFallback);
}
APP.eventSource.on(APP.event_types.CHARACTER_MESSAGE_RENDERED, inspectResponse);

console.log('[Memo] 一次API最终请求 fallback + 固定tableEdit诊断已加载');
