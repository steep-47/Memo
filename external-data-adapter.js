/**
 * 外部数据适配器模块
 * 
 * 功能：为外部程序提供数据注入接口，将外部数据转发给项目内部的核心处理模块
 * 设计原则：最小侵入性，不修改原项目核心逻辑，仅作为数据转发和格式适配层
 * 
 * @module external-data-adapter
 * @version 1.0.0
 * @author AI Assistant
 * @date 2025-10-05
 */

import { executeTableEditActions, getTableEditTag, updateSheetsView } from './index.js';
import { BASE, USER } from './core/manager.js';

/**
 * 适配器状态
 */
const adapterState = {
    initialized: false,
    lastError: null,
    operationCount: 0,
    debugMode: false
};

/**
 * 日志工具
 */
const logger = {
    info: (message, ...args) => {
        console.log(`[ExternalDataAdapter] ${message}`, ...args);
    },
    warn: (message, ...args) => {
        console.warn(`[ExternalDataAdapter] ⚠️ ${message}`, ...args);
    },
    error: (message, ...args) => {
        console.error(`[ExternalDataAdapter] ❌ ${message}`, ...args);
        adapterState.lastError = { message, timestamp: new Date(), args };
    },
    debug: (message, ...args) => {
        if (adapterState.debugMode) {
            console.log(`[ExternalDataAdapter] 🔍 ${message}`, ...args);
        }
    }
};

/**
 * 数据验证器
 */
const validator = {
    /**
     * 验证表格是否存在
     */
    checkTablesExist() {
        try {
            const sheets = BASE.getChatSheets();
            if (!sheets || sheets.length === 0) {
                return { valid: false, error: '未找到任何表格，请先在聊天中创建表格' };
            }
            const enabledSheets = sheets.filter(sheet => sheet.enable);
            if (enabledSheets.length === 0) {
                return { valid: false, error: '没有启用的表格，请启用至少一个表格' };
            }
            return { valid: true, sheets: enabledSheets };
        } catch (error) {
            return { valid: false, error: `表格检查失败: ${error.message}` };
        }
    },

    /**
     * 验证 tableEdit 指令格式
     */
    validateTableEditString(editString) {
        if (typeof editString !== 'string' || !editString.trim()) {
            return { valid: false, error: '编辑指令必须是非空字符串' };
        }

        // 检查是否包含有效的操作函数
        const validOperations = ['insertRow', 'updateRow', 'deleteRow'];
        const hasValidOperation = validOperations.some(op => editString.includes(op));
        
        if (!hasValidOperation) {
            return { valid: false, error: `编辑指令必须包含以下操作之一: ${validOperations.join(', ')}` };
        }

        return { valid: true };
    },

    /**
     * 验证 JSON 操作对象
     */
    validateJsonOperation(operation) {
        if (!operation || typeof operation !== 'object') {
            return { valid: false, error: '操作必须是对象' };
        }

        const { type, tableIndex } = operation;

        if (!['insert', 'update', 'delete'].includes(type)) {
            return { valid: false, error: `无效的操作类型: ${type}` };
        }

        if (typeof tableIndex !== 'number' || tableIndex < 0) {
            return { valid: false, error: `无效的表格索引: ${tableIndex}` };
        }

        if (type === 'insert' && !operation.data) {
            return { valid: false, error: 'insert 操作必须包含 data 字段' };
        }

        if (type === 'update' && (!operation.data || typeof operation.rowIndex !== 'number')) {
            return { valid: false, error: 'update 操作必须包含 data 和 rowIndex 字段' };
        }

        if (type === 'delete' && typeof operation.rowIndex !== 'number') {
            return { valid: false, error: 'delete 操作必须包含 rowIndex 字段' };
        }

        return { valid: true };
    }
};

/**
 * 格式转换器
 */
const converter = {
    /**
     * 从 XML 格式提取编辑指令
     * @param {string} xmlString - 包含 <tableEdit> 标签的 XML 字符串
     * @returns {string[]} 编辑指令数组
     */
    extractFromXml(xmlString) {
        logger.debug('提取 XML 格式数据', xmlString);
        const { matches } = getTableEditTag(xmlString);
        logger.debug('提取结果', matches);
        return matches;
    },

    /**
     * 将 JSON 操作对象转换为 tableEdit 指令字符串
     * @param {Object} operation - 操作对象
     * @returns {string} tableEdit 指令字符串
     */
    jsonToTableEditString(operation) {
        const { type, tableIndex, rowIndex, data } = operation;

        switch (type) {
            case 'insert':
                return `insertRow(${tableIndex}, ${JSON.stringify(data)})`;
            
            case 'update':
                return `updateRow(${tableIndex}, ${rowIndex}, ${JSON.stringify(data)})`;
            
            case 'delete':
                return `deleteRow(${tableIndex}, ${rowIndex})`;
            
            default:
                throw new Error(`未知的操作类型: ${type}`);
        }
    },

    /**
     * 将 JSON 操作数组转换为 matches 数组
     * @param {Object[]} operations - 操作对象数组
     * @returns {string[]} matches 数组
     */
    jsonArrayToMatches(operations) {
        logger.debug('转换 JSON 操作数组', operations);
        
        const instructions = operations.map(op => {
            const validation = validator.validateJsonOperation(op);
            if (!validation.valid) {
                throw new Error(validation.error);
            }
            return this.jsonToTableEditString(op);
        });

        const combinedString = '<!--\n' + instructions.join('\n') + '\n-->';
        logger.debug('生成的指令字符串', combinedString);
        
        return [combinedString];
    }
};

/**
 * 核心适配器函数
 */
const adapter = {
    /**
     * 处理 XML 格式的 tableEdit 数据
     * @param {string} xmlString - 包含 <tableEdit> 标签的 XML 字符串
     * @returns {Promise<Object>} 处理结果 {success, message, data}
     */
    async processXmlData(xmlString) {
        logger.info('处理 XML 格式数据');

        try {
            // 验证表格存在
            const tableCheck = validator.checkTablesExist();
            if (!tableCheck.valid) {
                return { success: false, message: tableCheck.error };
            }

            // 验证数据格式
            const validation = validator.validateTableEditString(xmlString);
            if (!validation.valid) {
                return { success: false, message: validation.error };
            }

            // 提取编辑指令
            const matches = converter.extractFromXml(xmlString);
            if (!matches || matches.length === 0) {
                return { success: false, message: '未能从 XML 中提取有效的编辑指令' };
            }

            // 执行操作
            const result = executeTableEditActions(matches, null);

            if (result) {
                // 关键修复1：保存聊天数据到文件，确保数据持久化
                try {
                    await USER.saveChat();
                    logger.debug('聊天数据已保存到文件');
                } catch (saveError) {
                    logger.warn('保存聊天数据失败', saveError);
                    return { success: false, message: `表格已在当前页面修改，但聊天保存失败: ${saveError.message || saveError}`, error: saveError };
                }

                // 关键修复2：刷新表格视图，确保界面更新
                try {
                    await updateSheetsView();
                    logger.debug('表格视图已刷新');
                } catch (viewError) {
                    logger.warn('刷新表格视图失败', viewError);
                }

                adapterState.operationCount++;
                logger.info(`✅ 操作成功执行 (总计: ${adapterState.operationCount})`);
                return {
                    success: true,
                    message: '数据处理成功',
                    data: {
                        operationsExecuted: matches.length,
                        totalOperations: adapterState.operationCount
                    }
                };
            } else {
                return { success: false, message: '执行表格编辑操作失败，请查看控制台日志' };
            }

        } catch (error) {
            logger.error('处理 XML 数据时发生错误', error);
            return { success: false, message: `错误: ${error.message}`, error };
        }
    },

    /**
     * 处理 JSON 格式的操作数据
     * @param {Object|Object[]} jsonData - JSON 操作对象或数组
     * @returns {Promise<Object>} 处理结果 {success, message, data}
     */
    async processJsonData(jsonData) {
        logger.info('处理 JSON 格式数据');

        try {
            // 验证表格存在
            const tableCheck = validator.checkTablesExist();
            if (!tableCheck.valid) {
                return { success: false, message: tableCheck.error };
            }

            // 标准化为数组
            const operations = Array.isArray(jsonData) ? jsonData : 
                              (jsonData.operations ? jsonData.operations : [jsonData]);

            if (operations.length === 0) {
                return { success: false, message: '操作数组为空' };
            }

            // 转换为 matches 格式
            const matches = converter.jsonArrayToMatches(operations);

            // 执行操作
            const result = executeTableEditActions(matches, null);

            if (result) {
                // 关键修复1：保存聊天数据到文件，确保数据持久化
                try {
                    await USER.saveChat();
                    logger.debug('聊天数据已保存到文件');
                } catch (saveError) {
                    logger.warn('保存聊天数据失败', saveError);
                    return { success: false, message: `表格已在当前页面修改，但聊天保存失败: ${saveError.message || saveError}`, error: saveError };
                }

                // 关键修复2：刷新表格视图，确保界面更新
                try {
                    await updateSheetsView();
                    logger.debug('表格视图已刷新');
                } catch (viewError) {
                    logger.warn('刷新表格视图失败', viewError);
                }

                adapterState.operationCount++;
                logger.info(`✅ 操作成功执行 (总计: ${adapterState.operationCount})`);
                return {
                    success: true,
                    message: '数据处理成功',
                    data: {
                        operationsExecuted: operations.length,
                        totalOperations: adapterState.operationCount
                    }
                };
            } else {
                return { success: false, message: '执行表格编辑操作失败，请查看控制台日志' };
            }

        } catch (error) {
            logger.error('处理 JSON 数据时发生错误', error);
            return { success: false, message: `错误: ${error.message}`, error };
        }
    },

    /**
     * 自动检测格式并处理数据
     * @param {string|Object} data - 输入数据（XML 字符串或 JSON 对象）
     * @returns {Promise<Object>} 处理结果
     */
    async processData(data) {
        if (typeof data === 'string') {
            return await this.processXmlData(data);
        } else if (typeof data === 'object') {
            return await this.processJsonData(data);
        } else {
            return { success: false, message: '不支持的数据类型，请提供 XML 字符串或 JSON 对象' };
        }
    }
};

/**
 * 初始化外部数据适配器
 * @param {Object} options - 配置选项
 * @param {boolean} options.debugMode - 是否启用调试模式
 */
export function initExternalDataAdapter(options = {}) {
    if (adapterState.initialized) {
        logger.warn('适配器已经初始化');
        return;
    }

    adapterState.debugMode = options.debugMode || false;
    adapterState.initialized = true;

    logger.info('外部数据适配器初始化成功');
    logger.info(`调试模式: ${adapterState.debugMode ? '开启' : '关闭'}`);

    // 将适配器接口暴露到全局
    if (typeof window !== 'undefined') {
        window.externalDataAdapter = {
            processXmlData: adapter.processXmlData.bind(adapter),
            processJsonData: adapter.processJsonData.bind(adapter),
            processData: adapter.processData.bind(adapter),
            getState: () => ({ ...adapterState }),
            setDebugMode: (enabled) => { adapterState.debugMode = enabled; },
            getLastError: () => adapterState.lastError
        };
        logger.info('适配器接口已暴露到 window.externalDataAdapter');
    }
}

/**
 * 导出适配器接口（用于 Node.js 环境或模块导入）
 */
export const externalDataAdapter = {
    processXmlData: adapter.processXmlData.bind(adapter),
    processJsonData: adapter.processJsonData.bind(adapter),
    processData: adapter.processData.bind(adapter),
    getState: () => ({ ...adapterState }),
    setDebugMode: (enabled) => { adapterState.debugMode = enabled; },
    getLastError: () => adapterState.lastError
};

export default externalDataAdapter;
