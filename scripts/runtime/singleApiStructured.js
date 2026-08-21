import { APP, EDITOR, USER } from '../../core/manager.js';
import { executeTableEditActions, getTableEditTag } from '../../index.js';

const PREF_KEY = 'independent_record_api_enabled';
const STRUCTURED_SCHEMA_NAME = 'memo_single_api_response';
const handledMessages = new WeakMap();
let pendingStructuredRequest = null;
let armedGeneration = null;
let streamRestore = null;

const MEMO_SCHEMA = {
    name: STRUCTURED_SCHEMA_NAME,
    description: 'Memo一次API：同一次模型响应同时返回机器表格操作和正常可见回复。',
    strict: true,
    value: {
        type: 'object',
        additionalProperties: false,
        properties: {
            table_edit: {
                type: 'string',
                description: '仅填写Memo表格操作代码：insertRow/updateRow/deleteRow；没有变化时填写NO_CHANGE。不要包含<tableEdit>标签、Markdown或解释。',
            },
            reply: {
                type: 'string',
                description: '给用户看的完整正常回复。保持角色原有写作风格和自然顺序；不要包含Memo、tableEdit、JSON说明或机器记录。',
            },
        },
        required: ['table_edit', 'reply'],
    },
};

function independentEnabled() {
    return USER?.getSettings?.()?.muyoo_dataTable?.[PREF_KEY] === true;
}

function singleApiActive() {
    const settings = USER?.tableBaseSetting;
    return !independentEnabled()
        && settings?.isExtensionAble !== false
        && settings?.isAiWriteTable !== false
        && settings?.step_by_step !== true;
}

function isChatReplyGeneration(type, dryRun = false) {
    if (!singleApiActive() || dryRun) return false;
    const value = String(type ?? '').toLowerCase();
    return value !== 'quiet' && value !== 'impersonate';
}

function isAppendGeneration(type) {
    const value = String(type ?? '').toLowerCase();
    return value === 'continue' || value === 'append' || value === 'appendfinal';
}

function currentLastAssistant() {
    const chat = USER?.getContext?.()?.chat;
    if (!Array.isArray(chat) || !chat.length) return null;
    const last = chat[chat.length - 1];
    return last && last.is_user !== true ? last : null;
}

function parseStructuredPayload(raw) {
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
    let text = String(raw ?? '').trim();
    if (!text) return null;

    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    try {
        return JSON.parse(text);
    } catch (_) {
        const first = text.indexOf('{');
        const last = text.lastIndexOf('}');
        if (first >= 0 && last > first) {
            try { return JSON.parse(text.slice(first, last + 1)); } catch (_) { /* noop */ }
        }
    }
    return null;
}

function normalizeTableEdit(raw) {
    let value = String(raw ?? '').trim();
    if (!value || /^NO_CHANGE$/i.test(value)) return 'NO_CHANGE';
    value = value
        .replace(/^\s*<tableEdit>\s*/i, '')
        .replace(/\s*<\/tableEdit>\s*$/i, '')
        .replace(/^\s*<!--\s*/, '')
        .replace(/\s*-->\s*$/, '')
        .trim();
    return value || 'NO_CHANGE';
}

function buildLegacyCompatibleMessage(reply, tableEdit) {
    const visibleReply = String(reply ?? '').trim();
    const machineBlock = tableEdit === 'NO_CHANGE'
        ? '<tableEdit><!-- NO_CHANGE --></tableEdit>'
        : `<tableEdit><!--\n${tableEdit}\n--></tableEdit>`;
    return `${visibleReply}\n\n${machineBlock}`.trim();
}

function appendStructuredSegment(base, reply, tableEdit) {
    const nextSegment = buildLegacyCompatibleMessage(reply, tableEdit);
    const prefix = String(base ?? '').trimEnd();
    return prefix ? `${prefix}\n\n${nextSegment}` : nextSegment;
}

function syncCurrentSwipe(chat) {
    if (!Array.isArray(chat?.swipes)) return;
    const id = Number(chat?.swipe_id);
    if (!Number.isInteger(id) || id < 0 || id >= chat.swipes.length) return;
    chat.swipes[id] = chat.mes;
}

function consumePending() {
    const pending = pendingStructuredRequest;
    pendingStructuredRequest = null;
    return pending;
}

function restoreStreamingSetting() {
    if (!streamRestore) return;
    const { settings, value, timer } = streamRestore;
    streamRestore = null;
    if (timer) clearTimeout(timer);
    try { settings.stream_openai = value; } catch (_) { /* noop */ }
}

function armGeneration(type, _options, dryRun) {
    restoreStreamingSetting();
    pendingStructuredRequest = null;
    armedGeneration = isChatReplyGeneration(type, dryRun)
        ? { type: String(type ?? ''), startedAt: Date.now() }
        : null;
}

function prepareStructuredPrompt(eventData) {
    if (!armedGeneration || !singleApiActive() || eventData?.dryRun === true) return;
    const settings = USER?.getContext?.()?.chatCompletionSettings;
    if (!settings || settings.stream_openai !== true) return;

    settings.stream_openai = false;
    const timer = setTimeout(() => restoreStreamingSetting(), 15000);
    streamRestore = { settings, value: true, timer };
    console.log('[Memo][structured] 本轮结构化主回复临时关闭流式；完成参数计算后自动恢复用户设置');
}

async function injectStructuredSchema(generateData) {
    if (!armedGeneration || !singleApiActive() || !generateData || typeof generateData !== 'object') {
        restoreStreamingSetting();
        return;
    }

    if (generateData.json_schema && generateData.json_schema?.name !== STRUCTURED_SCHEMA_NAME) {
        console.warn('[Memo][structured] 检测到其他JSON schema，将由Memo一次API结构覆盖以保证单次写表。', generateData.json_schema);
    }

    const previousAssistant = currentLastAssistant();
    pendingStructuredRequest = {
        createdAt: Date.now(),
        generationType: armedGeneration.type,
        baseChat: previousAssistant,
        baseMes: previousAssistant ? String(previousAssistant.mes ?? '') : '',
    };
    armedGeneration = null;

    try {
        generateData.json_schema = structuredClone(MEMO_SCHEMA);
    } catch (_) {
        generateData.json_schema = JSON.parse(JSON.stringify(MEMO_SCHEMA));
    }

    restoreStreamingSetting();
    console.log('[Memo][structured] 已向本次真实角色回复注入双字段JSON schema');
}

function markCurrentMessageTableEditsHandled(chat) {
    try {
        const { matches } = getTableEditTag(String(chat?.mes ?? ''));
        chat.tableEditMatches = Array.isArray(matches) ? [...matches] : [];
    } catch (error) {
        console.warn('[Memo][structured] 标记Continue已处理tableEdit失败，将允许原parser兜底', error);
    }
}

async function unpackStructuredReply(chatId) {
    if (!singleApiActive()) return;
    const pending = pendingStructuredRequest;
    if (!pending) return;

    if (Date.now() - pending.createdAt > 5 * 60 * 1000) {
        consumePending();
        console.warn('[Memo][structured] 丢弃过期结构化请求标记');
        return;
    }

    const chat = USER?.getContext?.()?.chat?.[chatId];
    if (!chat || chat.is_user) return;
    if (handledMessages.get(chat) === chat.mes) return;

    const currentMes = String(chat.mes ?? '');
    let basePrefix = '';
    let structuredRaw = currentMes;

    if (isAppendGeneration(pending.generationType)
        && pending.baseChat === chat
        && pending.baseMes
        && currentMes.startsWith(pending.baseMes)) {
        basePrefix = pending.baseMes;
        structuredRaw = currentMes.slice(pending.baseMes.length).trim();
    }

    const payload = parseStructuredPayload(structuredRaw);
    if (!payload || typeof payload !== 'object' || !('reply' in payload) || !('table_edit' in payload)) {
        consumePending();
        console.warn(`[Memo][structured] ${pending.generationType || 'reply'} 最终内容不是预期双字段结构：`, structuredRaw);
        EDITOR.warning('一次API结构化响应解析失败：本轮仍只有1次API调用，表格未自动记录。');
        return;
    }

    const reply = String(payload.reply ?? '').trim();
    const tableEdit = normalizeTableEdit(payload.table_edit);
    if (!reply) {
        consumePending();
        EDITOR.warning('一次API结构化响应缺少正文 reply；本轮表格暂不执行。');
        return;
    }

    consumePending();
    chat.mes = basePrefix
        ? appendStructuredSegment(basePrefix, reply, tableEdit)
        : buildLegacyCompatibleMessage(reply, tableEdit);
    syncCurrentSwipe(chat);
    handledMessages.set(chat, chat.mes);

    if (basePrefix) {
        let handledDirectly = tableEdit === 'NO_CHANGE';
        if (!handledDirectly) {
            try {
                handledDirectly = executeTableEditActions([tableEdit]) !== false;
            } catch (error) {
                console.warn('[Memo][structured] Continue本轮tableEdit直接执行失败，将交给原parser兜底', error);
                handledDirectly = false;
            }
        }
        if (handledDirectly) markCurrentMessageTableEditsHandled(chat);
    }

    try {
        const context = USER.getContext();
        if (typeof context?.updateMessageBlock === 'function') context.updateMessageBlock(Number(chatId), chat);
    } catch (error) {
        console.warn('[Memo][structured] 重绘正常正文失败，但不阻断原Memo写表流程', error);
    }

    console.log(`[Memo][structured] 单次响应已拆包：${basePrefix ? '续写追加' : '完整回复'}｜table_edit=${tableEdit === 'NO_CHANGE' ? 'NO_CHANGE' : '有操作'}｜reply=${reply.length}字`);
}

const startedEvent = APP.event_types.GENERATION_STARTED;
if (startedEvent) APP.eventSource.on(startedEvent, armGeneration);

const promptEvent = APP.event_types.CHAT_COMPLETION_PROMPT_READY;
if (promptEvent) {
    APP.eventSource.on(promptEvent, prepareStructuredPrompt);
    if (typeof APP.eventSource.makeLast === 'function') APP.eventSource.makeLast(promptEvent, prepareStructuredPrompt);
}

const settingsEvent = APP.event_types.CHAT_COMPLETION_SETTINGS_READY;
if (settingsEvent) {
    APP.eventSource.on(settingsEvent, injectStructuredSchema);
    if (typeof APP.eventSource.makeLast === 'function') APP.eventSource.makeLast(settingsEvent, injectStructuredSchema);
}

const renderedEvent = APP.event_types.CHARACTER_MESSAGE_RENDERED;
APP.eventSource.on(renderedEvent, unpackStructuredReply);
if (typeof APP.eventSource.makeFirst === 'function') APP.eventSource.makeFirst(renderedEvent, unpackStructuredReply);

console.log('[Memo] 一次API结构化双通道已加载：正文生成令牌 + pending绑定 + Continue增量执行 + 单轮临时非流式');
