import { APP, EDITOR, USER } from '../../core/manager.js';
import { getTableEditTag } from '../../index.js';

const PREF_KEY = 'independent_record_api_enabled';
let lastDiag = null;

function independentEnabled() {
    return USER?.getSettings?.()?.muyoo_dataTable?.[PREF_KEY] === true;
}

function inspectPrompt(eventData) {
    if (independentEnabled()) {
        lastDiag = null;
        return;
    }

    const chat = Array.isArray(eventData?.chat) ? eventData.chat : [];
    const candidates = chat.map((m, index) => ({
        index,
        role: m?.role,
        content: String(m?.content ?? ''),
    })).filter(item =>
        item.content.includes('# dataTable 世界状态记忆') ||
        (item.content.includes('<tableEdit>') && item.content.includes('insertRow('))
    );

    const hit = candidates.at(-1) || null;
    lastDiag = {
        promptFound: !!hit,
        promptIndex: hit?.index ?? -1,
        promptRole: hit?.role ?? '',
        chatLength: chat.length,
        promptTail: hit ? hit.content.slice(-600) : '',
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
    const hasTableEdit = Array.isArray(matches) && matches.length > 0;
    const hasExecutableCode = /(?:insertRow|updateRow|deleteRow)\s*\(/.test(matches?.join('\n') ?? '');

    const diag = {
        ...(lastDiag || {}),
        responseHasTableEdit: hasTableEdit,
        responseHasExecutableCode: hasExecutableCode,
        responseTail: mes.slice(-600),
        responseAt: Date.now(),
    };
    globalThis.__memoSingleApiDiag = diag;
    console.log('[Memo诊断] 一次API最终回复检查', diag);

    if (hasExecutableCode) return;

    if (lastDiag?.promptFound) {
        EDITOR.warning('一次API诊断：提示已注入，但模型未输出填表代码');
    } else {
        EDITOR.error('一次API诊断：Memo提示未进入最终请求');
    }
}

APP.eventSource.on(APP.event_types.CHAT_COMPLETION_PROMPT_READY, inspectPrompt);
APP.eventSource.on(APP.event_types.CHARACTER_MESSAGE_RENDERED, inspectResponse);

console.log('[Memo] 一次API诊断模块已加载');
