import applicationFunctionManager from "./appFuncManager.js";

let _lang = undefined;
let _translations = undefined;

/**
 * 异步获取翻译文件
 * @param {string} locale - 语言标识符 (e.g., 'en', 'zh-cn')
 * @returns {Promise<Object>} - 翻译对象
 */
async function fetchTranslations(locale) {
    try {
        const response = await fetch(`/scripts/extensions/third-party/Memo/assets/locales/${locale}.json`);
        if (!response.ok) {
            console.warn(`Could not load translations for ${locale}, falling back to zh-cn`);
            if (locale !== 'zh-cn') {
                return await fetchTranslations('zh-cn');
            }
            return {};
        }
        return await response.json();
    } catch (error) {
        console.error('Error loading translations:', error);
        return {};
    }
}

async function getTranslationsConfig() {
    if (_lang === undefined) {
        _lang = applicationFunctionManager.getCurrentLocale();
    }
    if (_lang === undefined) {
        _lang = 'zh-cn';
        return { translations: {}, lang: _lang };
    }
    if (_translations === undefined) {
        _translations = await fetchTranslations(_lang)
    }
    return { translations: _translations, lang: _lang };
}

function applyTranslations(translations) {
    console.log("Applying translations", translations);
    document.querySelectorAll('[data-i18n]').forEach(element => {
        const key = element.getAttribute('data-i18n');
        if (translations[key]) {
            if (element.hasAttribute('title')) {
                element.setAttribute('title', translations[key]);
            } else {
                element.textContent = translations[key];
            }
        }
    });

    translateElementsBySelector(translations, '#table_clear_up a', "Reorganize tables now");
    translateElementsBySelector(translations, '#dataTable_to_chat_button a', "Edit style of tables rendered in conversation");
}

function translateElementsBySelector(translations, selector, key) {
    if (translations[key]) {
        const elements = document.querySelectorAll(selector);
        elements.forEach(element => {
            element.textContent = translations[key];
        });
    }
}

export async function translating(targetScope, source) {
    let { translations, lang } = await getTranslationsConfig();
    if (lang === 'zh-cn') {
        return source;
    }

    translations = translations[targetScope];
    function translateRecursively(obj) {
        if (typeof obj === 'string') {
            return translations[obj] || obj;
        }
        if (Array.isArray(obj)) {
            return obj.map(item => translateRecursively(item));
        }
        if (obj !== null && typeof obj === 'object') {
            const result = {};
            for (const key in obj) {
                if (Object.prototype.hasOwnProperty.call(obj, key)) {
                    result[key] = translateRecursively(obj[key]);
                }
            }
            return result;
        }
        return obj;
    }

    if (!translations || Object.keys(translations).length === 0) {
        console.warn("No translations available for locale:", lang);
        return source;
    }

    if (source !== null && typeof source === 'object') {
        return translateRecursively(source);
    }

    return source;
}

export async function switchLanguage(targetScope, source) {
    const { translations, lang } = await getTranslationsConfig()
    if (lang === 'zh-cn') {
        return source;
    }

    return {...source, ...translations[targetScope] || {}};
}

export async function executeTranslation() {
    const { translations, lang } = await getTranslationsConfig();
    if (lang === 'zh-cn') {
        return;
    }

    console.log("Current Locale: ", lang);
    if (Object.keys(translations).length === 0) {
        console.warn("No translations found for locale:", lang);
        return;
    }

    applyTranslations(translations);
    console.log("Translation completed for locale:", lang);
}
