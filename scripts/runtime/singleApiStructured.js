import { APP, EDITOR, USER } from '../../core/manager.js';

const PREF_KEY = 'independent_record_api_enabled';
const STRUCTURED_SCHEMA_NAME = 'memo_single_api_response';
const handledMessages = new WeakMap();

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

function parseStructuredPayload(raw) {
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
    let text = String(raw ?? '').trim();
    if (!text) return null;

    // 兼容少数提供方即使启用JSON schema仍包代码块的情况。
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

    // 恢复原来的自然顺序：正文/选项/留言在前，机器记录在最后。
    return `${visibleReply}\n\n${machineBlock}`.trim();
}

function syncCurrentSwipe(chat) {
    if (!Array.isArray(chat?.swipes)) return;
    const id = Number(chat?.swipe_id);
    if (!Number.isInteger(id) || id < 0 || id >= chat.swipes.length) return;
    chat.swipes[id] = chat.mes;
}

async function injectStructuredSchema(generateData) {
    if (!singleApiActive() || !generateData || typeof generateData !== 'object') return;

    if (generateData.json_schema && generateData.json_schema?.name !== STRUCTURED_SCHEMA_NAME) {
        console.warn('[Memo][structured] 检测到其他JSON schema，将由Memo一次API结构覆盖以保证单次写表。', generateData.json_schema);
    }

    try {
        generateData.json_schema = structuredClone(MEMO_SCHEMA);
    } catch (_) {
        generateData.json_schema = JSON.parse(JSON.stringify(MEMO_SCHEMA));
    }
    console.log('[Memo][structured] 已向本次主API请求注入双字段JSON schema');
}

async function unpackStructuredReply(chatId) {
    if (!singleApiActive()) return;

    const chat = USER?.getContext?.()?.chat?.[chatId];
    if (!chat || chat.is_user) return;
    if (handledMessages.get(chat) === chat.mes) return;

    const payload = parseStructuredPayload(chat.mes);
    if (!payload || typeof payload !== 'object' || !('reply' in payload) || !('table_edit' in payload)) {
        console.warn('[Memo][structured] 最终正文不是预期的双字段结构：', chat.mes);
        EDITOR.warning('一次API结构化响应解析失败：本轮仍只有1次API调用，表格未自动记录。');
        return;
    }

    const reply = String(payload.reply ?? '').trim();
    const tableEdit = normalizeTableEdit(payload.table_edit);
    if (!reply) {
        EDITOR.warning('一次API结构化响应缺少正文 reply；本轮表格暂不执行。');
        return;
    }

    chat.mes = buildLegacyCompatibleMessage(reply, tableEdit);
    syncCurrentSwipe(chat);
    handledMessages.set(chat, chat.mes);

    // CHARACTER_MESSAGE_RENDERED发生时原JSON已经绘制过；立即重绘为正常正文。
    try {
        const context = USER.getContext();
        if (typeof context?.updateMessageBlock === 'function') {
            context.updateMessageBlock(Number(chatId), chat);
        }
    } catch (error) {
        console.warn('[Memo][structured] 重绘正常正文失败，但不阻断原Memo写表流程', error);
    }

    // 只保存本地拆包结果；不产生任何额外模型/API请求。
    try { USER.saveChat(); } catch (_) { /* 原生Memo随后也会保存Sheet */ }
    console.log(`[Memo][structured] 单次响应已拆包：table_edit=${tableEdit === 'NO_CHANGE' ? 'NO_CHANGE' : '有操作'}，reply=${reply.length}字`);
}

const settingsEvent = APP.event_types.CHAT_COMPLETION_SETTINGS_READY;
if (settingsEvent) {
    APP.eventSource.on(settingsEvent, injectStructuredSchema);
    if (typeof APP.eventSource.makeLast === 'function') APP.eventSource.makeLast(settingsEvent, injectStructuredSchema);
}

const renderedEvent = APP.event_types.CHARACTER_MESSAGE_RENDERED;
APP.eventSource.on(renderedEvent, unpackStructuredReply);
if (typeof APP.eventSource.makeFirst === 'function') APP.eventSource.makeFirst(renderedEvent, unpackStructuredReply);

console.log('[Memo] 一次API结构化双通道已加载：1次请求 = table_edit + reply');
