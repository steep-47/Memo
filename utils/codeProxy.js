import {BASE, DERIVED, EDITOR, SYSTEM, USER} from '../core/manager.js';

/**
 * @description 辅助函数，递归创建 Proxy
 * @param {Object} obj - 要代理的对象
 * @returns {Object} - 创建的 Proxy 对象
 */
export const createProxy = (obj) => {
    return new Proxy(obj, {
        get(target, prop) {
            return target[prop];
        },
        set(target, prop, newValue) {
            target[prop] = newValue;
            return true;
        },
    });
}

function cloneDefaultValue(value) {
    if (value === null || typeof value !== 'object') return value;
    try {
        return structuredClone(value);
    } catch (_) {
        return JSON.parse(JSON.stringify(value));
    }
}

export const createProxyWithUserSetting = (target, allowEmpty = false) => {
    return new Proxy({}, {
        get: (_, property) => {
            // 最优先从用户设置数据中获取
            if (USER.getSettings()[target] && property in USER.getSettings()[target]) {
                return USER.getSettings()[target][property];
            }

            // 尝试从老版本的数据位置迁移
            if (USER.getExtensionSettings()[target] && property in USER.getExtensionSettings()[target]) {
                console.log(`变量 ${property} 未在用户配置中找到, 已从老版本数据中获取`);
                const value = USER.getExtensionSettings()[target][property];
                if (!USER.getSettings()[target]) USER.getSettings()[target] = {};
                USER.getSettings()[target][property] = value;
                return value;
            }

            // 缺失的标准字段从默认设置补齐，并持久化到当前用户设置。
            // 这样旧用户、缺字段配置和导入旧预设都会自动归一化，且绝不覆盖已有用户值。
            if (USER.tableBaseDefaultSettings && property in USER.tableBaseDefaultSettings) {
                const value = cloneDefaultValue(USER.tableBaseDefaultSettings[property]);
                if (!USER.getSettings()[target]) USER.getSettings()[target] = {};
                USER.getSettings()[target][property] = value;
                console.log(`变量 ${property} 未找到, 已从默认设置补齐`);
                USER.saveSettings();
                return value;
            }

            if (allowEmpty) return undefined;
            EDITOR.error(`变量 ${property} 未在默认设置中找到, 请检查代码`);
            return undefined;
        },
        set: (_, property, value) => {
            console.log(`设置变量 ${property} 为 ${value}`);
            if (!USER.getSettings()[target]) USER.getSettings()[target] = {};
            USER.getSettings()[target][property] = value;
            USER.saveSettings();
            return true;
        },
    })
}
