import { APP, USER } from '../../core/manager.js';
import { initTableData } from '../../index.js';

const PREF_KEY = 'independent_record_api_enabled';
const MODULE_NAME = 'memo_single_api_stable';

function independentEnabled() {
    return USER?.getSettings?.()?.muyoo_dataTable?.[PREF_KEY] === true;
}

function clearPrompt() {
    try {
        APP.setExtensionPrompt?.(MODULE_NAME, '', APP.extension_prompt_types?.NONE ?? 0, 0);
    } catch (error) {
        console.warn('[Memo] 清除一次API稳定注入失败', error);
    }
}

function getRole() {
    switch (USER.tableBaseSetting.injection_mode) {
        case 'deep_user': return APP.extension_prompt_roles?.USER ?? 1;
        case 'deep_assistant': return APP.extension_prompt_roles?.ASSISTANT ?? 2;
        case 'deep_system':
        default: return APP.extension_prompt_roles?.SYSTEM ?? 0;
    }
}

function installStablePrompt(eventData) {
    if (independentEnabled() ||
        USER.tableBaseSetting.isExtensionAble === false ||
        USER.tableBaseSetting.isAiReadTable === false ||
        USER.tableBaseSetting.injection_mode === 'injection_off') {
        clearPrompt();
        return;
    }

    try {
        const prompt = initTableData(eventData);
        if (!prompt) {
            clearPrompt();
            return;
        }

        // 使用 SillyTavern 原生 extension prompt 注入。
        // IN_CHAT + depth 0：尽可能靠近当前生成末端，避免长上下文稀释附加填表任务。
        const inChat = APP.extension_prompt_types?.IN_CHAT ?? 1;
        APP.setExtensionPrompt(MODULE_NAME, prompt, inChat, 0, false, getRole());
        console.log('[Memo] 一次API：已设置原生 extension prompt');
    } catch (error) {
        console.error('[Memo] 一次API稳定注入失败', error);
    }
}

// 在生成开始前先准备原生扩展提示；原作者的常规 eventData.chat 注入仍保留，
// 本轮先做兼容 A/B：增加一个靠近末端的强提示，不改解析/写表链。
const generationStarted = APP.event_types.GENERATION_STARTED;
if (generationStarted) APP.eventSource.on(generationStarted, installStablePrompt);

// 设置切换到独立API后及时清除，避免污染蓝色二次填表模式。
const promptReady = APP.event_types.CHAT_COMPLETION_PROMPT_READY;
APP.eventSource.on(promptReady, () => {
    if (independentEnabled()) clearPrompt();
});

console.log('[Memo] 一次API原生稳定注入已加载');
