import {BASE, DERIVED, EDITOR, SYSTEM, USER} from '../../core/manager.js';
import {updateSystemMessageTableStatus, updateAlternateTable} from "../renderer/tablePushToChat.js";
import {rebuildSheets , modifyRebuildTemplate, newRebuildTemplate, deleteRebuildTemplate, exportRebuildTemplate, importRebuildTemplate, triggerStepByStepNow} from "../runtime/absoluteRefresh.js";
import {generateDeviceId} from "../../utils/utility.js";
import {updateModelList, handleApiTestRequest ,processApiKey} from "./standaloneAPI.js";
import {filterTableDataPopup} from "../../data/pluginSetting.js";
import {initRefreshTypeSelector} from "../runtime/absoluteRefresh.js";
import {rollbackVersion} from "../../services/debugs.js";
import {customSheetsStylePopup} from "../editor/customSheetsStyle.js";
import {buildSheetsByTemplates} from "../../index.js"

/**
 * 格式化深度设置
 */
function formatDeep() {
    USER.tableBaseSetting.deep = Math.abs(USER.tableBaseSetting.deep)
}

/**
 * 更新设置中的开关状态
 */
function updateSwitch(selector, switchValue) {
    if (switchValue) {
        $(selector).prop('checked', true);
    } else {
        $(selector).prop('checked', false);
    }
}

/**
 * 更新设置中的表格结构DOM
 */
function updateTableView() {
    const show_drawer_in_extension_list = USER.tableBaseSetting.show_drawer_in_extension_list;
    const extensionsMenu = document.querySelector('#extensionsMenu');
    const show_settings_in_extension_menu = USER.tableBaseSetting.show_settings_in_extension_menu;
    const alternate_switch = USER.tableBaseSetting.alternate_switch;
    const extensions_settings = document.querySelector('#extensions_settings');

    if (show_drawer_in_extension_list === true) {
        // 如果不存在则创建
        if (document.querySelector('#drawer_in_extension_list_button')) return
        $(extensionsMenu).append(`
<div id="drawer_in_extension_list_button" class="list-group-item flex-container flexGap5 interactable">
    <div class="fa-solid fa-table extensionsMenuExtensionButton"></div>
    <span>增强记忆表格</span>
</div>
`);
        // 设置点击事件
        $('#drawer_in_extension_list_button').on('click', () => {
            $('#table_drawer_icon').click()
            $('#database_button').click();
        });
    } else {
        document.querySelector('#drawer_in_extension_list_button')?.remove();
    }

//     if (show_drawer_in_extension_list === true) {
//         // 如果不存在则创建
//         if (document.querySelector('#drawer_in_extension_list_button')) return
//         $(extensions_settings).append(`
// <div id="drawer_in_extension_list_button" class="list-group-item flex-container flexGap5 interactable">
// </div>
// `);
//     } else {
//
//     }
}

function getSheetsCellStyle() {
    const style = document.createElement('style');  // 为 sheetContainer 的内容添加一个 style
    // 获取 sheetContainer 元素
    const cellWidth = USER.tableBaseSetting.table_cell_width_mode
    let sheet_cell_style_container = document.querySelector('#sheet_cell_style_container');
    if (sheet_cell_style_container) {
        // 清空现有的样式
        sheet_cell_style_container.innerHTML = '';
    } else {
        // 创建一个新的 sheet_cell_style_container 元素
        sheet_cell_style_container = document.createElement('div');
        sheet_cell_style_container.id = 'sheet_cell_style_container';
        document.body.appendChild(sheet_cell_style_container);
    }
    switch (cellWidth) {
        case 'single_line':
            style.innerHTML = ``;
            break;
        case 'wide1_cell':
            style.innerHTML = ` tr .sheet-cell { max-width: 800px !important; white-space: normal !important; } `;
            break;
        case 'wide1_2_cell':
            style.innerHTML = ` tr .sheet-cell { max-width: 400px !important; white-space: normal !important; } `;
            break;
        case 'wide1_4_cell':
            style.innerHTML = ` tr .sheet-cell { max-width: 200px !important; white-space: normal !important; } `;
            break;
    }
    sheet_cell_style_container.appendChild(style);
}

/**
 * 将表格结构转为设置DOM
 * @param {object} tableStructure 表格结构
 * @returns 设置DOM
 */
function tableStructureToSettingDOM(tableStructure) {
    const tableIndex = tableStructure.tableIndex;
    const $item = $('<div>', { class: 'dataTable_tableEditor_item' });
    const $index = $('<div>').text(`#${tableIndex}`); // 编号
    const $input = $('<div>', {
        class: 'tableName_pole margin0',
    });
    $input.text(tableStructure.tableName);
    const $checkboxLabel = $('<label>', { class: 'checkbox' });
    const $checkbox = $('<input>', { type: 'checkbox', 'data-index': tableIndex, checked: tableStructure.enable, class: 'tableEditor_switch' });
    $checkboxLabel.append($checkbox, '启用');
    const $editButton = $('<div>', {
        class: 'menu_button menu_button_icon fa-solid fa-pencil tableEditor_editButton',
        title: '编辑',
        'data-index': tableIndex, // 绑定索引
    }).text('编辑');
    $item.append($index, $input, $checkboxLabel, $editButton);
    return $item;
}

/**
 * 导入插件设置
 */
async function importTableSet() {
    // 创建一个 input 元素，用于选择文件
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json'; // 限制文件类型为 JSON

    // 监听 input 元素的 change 事件，当用户选择文件后触发
    input.addEventListener('change', async (event) => {
        const file = event.target.files[0]; // 获取用户选择的文件

        if (!file) {
            return; // 用户未选择文件，直接返回
        }

        const reader = new FileReader(); // 创建 FileReader 对象来读取文件内容

        reader.onload = async (e) => {
            try {
                const importedData = JSON.parse(e.target.result); // 解析 JSON 文件内容

                // 获取导入 JSON 的第一级 key
                const firstLevelKeys = Object.keys(importedData);

                // 构建展示第一级 key 的 HTML 结构
                let keyListHTML = '<ul>';
                firstLevelKeys.forEach(key => {
                    keyListHTML += `<li>${key}</li>`;
                });
                keyListHTML += '</ul>';

                const tableInitPopup = $(`<div>
                    <p>即将导入的设置项 (第一级):</p>
                    ${keyListHTML}
                    <p>是否继续导入并重置这些设置？</p>
                </div>`);

                const confirmation = await EDITOR.callGenericPopup(tableInitPopup, EDITOR.POPUP_TYPE.CONFIRM, '导入设置确认', { okButton: "继续导入", cancelButton: "取消" });
                if (!confirmation) return; // 用户取消导入

                // 用户确认导入后，进行数据应用
                for (let key in importedData) {
                    USER.tableBaseSetting[key] = importedData[key];
                }

                renderSetting();
                initTableStructureToTemplate()
                BASE.refreshTempView(true)
                EDITOR.success('导入成功并已重置所选设置');

                try {
                    const { piece } = USER.getChatPiece() || {};
                    if (piece) {
                        const chatArr = USER.getContext()?.chat || [];
                        let isSheetEmpty = true;
                        for (let i = chatArr.length - 1; i >= 0; i--) {
                            if (chatArr[i] && Object.prototype.hasOwnProperty.call(chatArr[i], 'hash_sheets')) {
                                for (const sheet_id in chatArr[i].hash_sheets) {
                                    if (chatArr[i].hash_sheets[sheet_id].length > 1) {
                                        isSheetEmpty = false;
                                        break;
                                    }
                                }
                                break;
                            }
                        }
                        const confirmReplace = isSheetEmpty ? true : await EDITOR.callGenericPopup(
                            '是否清空旧表格数据（无法找回），并替换为新表格预设的模板（包括表格结构）<br>仅限新旧表格预设模板一致时可不替换<br>若新旧模板不一致，例如更换为不同表格预设时，应选择替换，否则将不能正常使用新预设<br>若同一表格预设更新版本，应参见预设发布说明，模板一致时可不替换',
                            EDITOR.POPUP_TYPE.CONFIRM,
                            '替换模板确认',
                            { okButton: '替换', cancelButton: '不替换' }
                        );
                        if (!confirmReplace) {
                            EDITOR.success && EDITOR.success('已取消模板替换');
                        } else {
                            BASE.sheetsData.context = {};
                            try {
                                for (const msg of chatArr) {
                                    if (msg && Object.prototype.hasOwnProperty.call(msg, 'hash_sheets')) delete msg.hash_sheets;
                                }
                            } catch (_) {}
                            buildSheetsByTemplates(piece);
                            BASE.refreshContextView();
                            BASE.refreshTempView(true)
                            updateSystemMessageTableStatus(true);
                            EDITOR.success('已用全局模板覆盖到 chat 域');
                        }
                    } else {
                        EDITOR.warning('因为当前聊天没有聊天载体所以跳过预设表格模板替换');
                    }
                } catch (e) {
                    console.warn('[Preset Import] 覆盖 chat 域模板时发生非致命错误：', e);
                }

            } catch (error) {
                EDITOR.error('JSON 文件解析失败，请检查文件格式是否正确。', error.message, error);
                console.error("文件读取或解析错误:", error);
            }
        };

        reader.onerror = (error) => {
            EDITOR.error(`文件读取失败`, error.message, error);
        };

        reader.readAsText(file);
    });

    input.click();
}

async function exportTableSet() {
    templateToTableStructure()
    const { filterData, confirmation } = await filterTableDataPopup(USER.tableBaseSetting,"请选择需要导出的数据","")
    if (!confirmation) return;

    try {
        const blob = new Blob([JSON.stringify(filterData)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a')
        a.href = url;
        a.download = `tableCustomConfig-${SYSTEM.generateRandomString(8)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        EDITOR.success('导出成功');
    } catch (error) {
        EDITOR.error(`导出失败`, error.message, error);
    }
}

async function resetSettings() {
    const { filterData, confirmation } = await filterTableDataPopup(USER.tableBaseDefaultSettings, "请选择需要重置的数据","建议重置前先备份数据")
    if (!confirmation) return;

    try {
        for (let key in filterData) USER.tableBaseSetting[key] = filterData[key]
        renderSetting()
        if('tableStructure' in filterData){
            initTableStructureToTemplate()
            BASE.refreshTempView(true)
        }
        EDITOR.success('已重置所选设置');
    } catch (error) {
        EDITOR.error(`重置设置失败`, error.message, error);
    }
}

function InitBinging() {
    console.log('初始化绑定')
    $('#table-set-import').on('click', () => importTableSet());
    $("#table-set-export").on('click', () => exportTableSet());
    $("#table-reset").on('click', () => resetSettings());
    $("#table-init-from-2-to-1").on('click', async () => {
        if (await rollbackVersion() === true) window.location.reload()
    });
    $('#table_switch').change(function () {
        USER.tableBaseSetting.isExtensionAble = this.checked;
        EDITOR.success(this.checked ? '插件已开启' : '插件已关闭，可以打开和手动编辑表格但AI不会读表和生成');
        updateSystemMessageTableStatus();
    });
    $('#table_switch_debug_mode').change(function () {
        USER.tableBaseSetting.tableDebugModeAble = this.checked;
        EDITOR.success(this.checked ? '调试模式已开启' : '调试模式已关闭');
    });
    $('#table_read_switch').change(function () {
        USER.tableBaseSetting.isAiReadTable = this.checked;
        EDITOR.success(this.checked ? 'AI现在会读取表格' : 'AI现在将不会读表');
    });
    $('#table_edit_switch').change(function () {
        USER.tableBaseSetting.isAiWriteTable = this.checked;
        EDITOR.success(this.checked ? 'AI的更改现在会被写入表格' : 'AI的更改现在不会被写入表格');
    });
    $('#dataTable_injection_mode').change(function (event) {
        USER.tableBaseSetting.injection_mode = event.target.value;
    });
    $("#fill_table_time").change(function() {
        const value = $(this).val();
        const step_by_step = value === 'after'
        $('#reply_options').toggle(!step_by_step);
        $('#step_by_step_options').toggle(step_by_step);
        USER.tableBaseSetting.step_by_step = step_by_step;
    })
    $('#confirm_before_execution').change(function() {
        USER.tableBaseSetting.confirm_before_execution = $(this).prop('checked');
    })
    $('#ignore_del').change(function() {
        USER.tableBaseSetting.bool_ignore_del = $(this).prop('checked');
    });
    $('#ignore_user_sent').change(function() {
        USER.tableBaseSetting.ignore_user_sent = $(this).prop('checked');
    });
    $('#bool_silent_refresh').change(function() {
        USER.tableBaseSetting.bool_silent_refresh = $(this).prop('checked');
    });
    $('#use_token_limit').change(function() {
        $('#token_limit_container').toggle(this.checked);
        $('#clear_up_stairs_container').toggle(!this.checked);
        USER.tableBaseSetting.use_token_limit = this.checked;
    });
    $('#use_main_api').change(function() {
        USER.tableBaseSetting.use_main_api = this.checked;
    });
    $('#step_by_step_use_main_api').change(function() {
        USER.tableBaseSetting.step_by_step_use_main_api = this.checked;
    });
    $('#model_selector').change(function(event) {
        $('#custom_model_name').val(event.target.value);
        USER.IMPORTANT_USER_PRIVACY_DATA.custom_model_name = event.target.value;
        USER.saveSettings && USER.saveSettings();
    });
    $('#table_to_chat').change(function () {
        USER.tableBaseSetting.isTableToChat = this.checked;
        EDITOR.success(this.checked ? '表格会被推送至对话中' : '关闭表格推送至对话');
        $('#table_to_chat_options').toggle(this.checked);
        updateSystemMessageTableStatus();
    });
    $('#show_settings_in_extension_menu').change(function () {
        USER.tableBaseSetting.show_settings_in_extension_menu = this.checked;
        updateTableView();
    });
    $('#alternate_switch').change(function () {
        USER.tableBaseSetting.alternate_switch = this.checked;
        EDITOR.success(this.checked ? '开启表格渲染穿插模式' : '关闭表格渲染穿插模式');
        updateTableView();
        updateAlternateTable();
    });
    $('#show_drawer_in_extension_list').change(function () {
        USER.tableBaseSetting.show_drawer_in_extension_list = this.checked;
        updateTableView();
    });
    $('#table_to_chat_can_edit').change(function () {
        USER.tableBaseSetting.table_to_chat_can_edit = this.checked;
        updateSystemMessageTableStatus();
    });
    $('#table_to_chat_mode').change(function(event) {
        USER.tableBaseSetting.table_to_chat_mode = event.target.value;
        $('#table_to_chat_is_micro_d').toggle(event.target.value === 'macro');
        updateSystemMessageTableStatus();
    });
    $('#table_cell_width_mode').change(function(event) {
        USER.tableBaseSetting.table_cell_width_mode = event.target.value;
        getSheetsCellStyle()
    });
    $('#custom_api_url').on('input', function() {
        USER.IMPORTANT_USER_PRIVACY_DATA.custom_api_url = $(this).val();
        USER.saveSettings && USER.saveSettings();
    });
    let apiKeyDebounceTimer;
    $('#custom_api_key').on('input', function () {
        clearTimeout(apiKeyDebounceTimer);
        apiKeyDebounceTimer = setTimeout(async () => {
            try {
                const rawKey = $(this).val();
                const result = processApiKey(rawKey, generateDeviceId());
                USER.IMPORTANT_USER_PRIVACY_DATA.custom_api_key = result.encryptedResult.encrypted || result.encryptedResult;
                USER.saveSettings && USER.saveSettings();
                EDITOR.success(result.message);
            } catch (error) {
                console.error('API Key 处理失败:', error);
                EDITOR.error('未能获取到API KEY，请重新输入~', error.message, error);
            }
        }, 500);
    })
    $('#custom_model_name').on('input', function() {
        USER.IMPORTANT_USER_PRIVACY_DATA.custom_model_name = $(this).val();
        USER.saveSettings && USER.saveSettings();
    });
    $('#dataTable_message_template').on("input", function () {
        USER.tableBaseSetting.message_template = $(this).val();
    })
    $('#dataTable_deep').on("input", function () {
        USER.tableBaseSetting.deep = Math.abs($(this).val());
    })
    $('#step_by_step_user_prompt').on('input', function() {
        USER.tableBaseSetting.step_by_step_user_prompt = $(this).val();
    });
    $('#separateReadContextLayers').on('input', function() {
        USER.tableBaseSetting.separateReadContextLayers = Number($(this).val());
    });
    $('#separateReadLorebook').change(function() {
        USER.tableBaseSetting.separateReadLorebook = this.checked;
        USER.saveSettings && USER.saveSettings();
    });
    $('#reset_step_by_step_user_prompt').on('click', function() {
        const defaultValue = USER.tableBaseDefaultSettings.step_by_step_user_prompt;
        $('#step_by_step_user_prompt').val(defaultValue);
        USER.tableBaseSetting.step_by_step_user_prompt = defaultValue;
        EDITOR.success('分步填表提示词已重置为默认值。');
    });
    $('#clear_up_stairs').on('input', function() {
        $('#clear_up_stairs_value').text($(this).val());
        USER.tableBaseSetting.clear_up_stairs = Number($(this).val());
    });
    $('#rebuild_token_limit').on('input', function() {
        $('#rebuild_token_limit_value').text($(this).val());
        USER.tableBaseSetting.rebuild_token_limit_value = Number($(this).val());
    });
    $('#custom_temperature').on('input', function() {
        $('#custom_temperature_value').text($(this).val());
        USER.tableBaseSetting.custom_temperature = Number($(this).val());
    });
    $('#table_proxy_address').on('input', function() {
        USER.IMPORTANT_USER_PRIVACY_DATA.table_proxy_address = $(this).val();
        USER.saveSettings && USER.saveSettings();
    });
    $('#table_proxy_key').on('input', function() {
        USER.IMPORTANT_USER_PRIVACY_DATA.table_proxy_key = $(this).val();
        USER.saveSettings && USER.saveSettings();
    });
    $('#fetch_models_button').on('click', updateModelList);
    $(document).on('click', '#table_test_api_button',async () => {
        await handleApiTestRequest($('#custom_api_url').val(), USER.IMPORTANT_USER_PRIVACY_DATA.custom_api_key, $('#custom_model_name').val());
    });
    $("#table_clear_up").on('click', () => { rebuildSheets() })
    $("#dataTable_to_chat_button").on("click", async function () { customSheetsStylePopup() })
    $("#rebuild--set-rename").on("click", modifyRebuildTemplate)
    $("#rebuild--set-new").on("click", newRebuildTemplate)
    $("#rebuild--set-delete").on("click", deleteRebuildTemplate)
    $("#rebuild--set-export").on("click", exportRebuildTemplate)
    $("#rebuild--set-import").on("click", importRebuildTemplate)
    $('#rebuild--select').on('change', function() {
        USER.tableBaseSetting.lastSelectedTemplate = $(this).val();
        USER.saveSettings && USER.saveSettings();
    });
    $(document).on('click', '#trigger_step_by_step_button', () => { triggerStepByStepNow(); });
}

export function renderSetting() {
    $(`#dataTable_injection_mode option[value="${USER.tableBaseSetting.injection_mode}"]`).prop('selected', true);
    $(`#table_to_chat_mode option[value="${USER.tableBaseSetting.table_to_chat_mode}"]`).prop('selected', true);
    $(`#table_cell_width_mode option[value="${USER.tableBaseSetting.table_cell_width_mode}"]`).prop('selected', true);
    $('#dataTable_message_template').val(USER.tableBaseSetting.message_template);
    $('#dataTable_deep').val(USER.tableBaseSetting.deep);
    $('#clear_up_stairs').val(USER.tableBaseSetting.clear_up_stairs);
    $('#clear_up_stairs_value').text(USER.tableBaseSetting.clear_up_stairs);
    $('#rebuild_token_limit').val(USER.tableBaseSetting.rebuild_token_limit_value);
    $('#rebuild_token_limit_value').text(USER.tableBaseSetting.rebuild_token_limit_value);
    $('#custom_temperature').val(USER.tableBaseSetting.custom_temperature);
    $('#custom_temperature_value').text(USER.tableBaseSetting.custom_temperature);
    $('#step_by_step_user_prompt').val(USER.tableBaseSetting.step_by_step_user_prompt || '');
    $('#separateReadContextLayers').val(USER.tableBaseSetting.separateReadContextLayers);
    updateSwitch('#separateReadLorebook', USER.tableBaseSetting.separateReadLorebook);
    $("#fill_table_time").val(USER.tableBaseSetting.step_by_step ? 'after' : 'chat');
    refreshRebuildTemplate()
    $('#custom_api_url').val(USER.IMPORTANT_USER_PRIVACY_DATA.custom_api_url || '');
    $('#custom_api_key').val(USER.IMPORTANT_USER_PRIVACY_DATA.custom_api_key || '');
    $('#custom_model_name').val(USER.IMPORTANT_USER_PRIVACY_DATA.custom_model_name || '');
    $('#table_proxy_address').val(USER.IMPORTANT_USER_PRIVACY_DATA.table_proxy_address || '');
    $('#table_proxy_key').val(USER.IMPORTANT_USER_PRIVACY_DATA.table_proxy_key || '');
    updateSwitch('#table_switch', USER.tableBaseSetting.isExtensionAble);
    updateSwitch('#table_switch_debug_mode', USER.tableBaseSetting.tableDebugModeAble);
    updateSwitch('#table_read_switch', USER.tableBaseSetting.isAiReadTable);
    updateSwitch('#table_edit_switch', USER.tableBaseSetting.isAiWriteTable);
    updateSwitch('#table_to_chat', USER.tableBaseSetting.isTableToChat);
    updateSwitch('#confirm_before_execution', USER.tableBaseSetting.confirm_before_execution);
    updateSwitch('#use_main_api', USER.tableBaseSetting.use_main_api);
    updateSwitch('#step_by_step_use_main_api', USER.tableBaseSetting.step_by_step_use_main_api);
    updateSwitch('#ignore_del', USER.tableBaseSetting.bool_ignore_del);
    updateSwitch('#bool_silent_refresh', USER.tableBaseSetting.bool_silent_refresh);
    updateSwitch('#ignore_user_sent', USER.tableBaseSetting.ignore_user_sent);
    updateSwitch('#show_settings_in_extension_menu', USER.tableBaseSetting.show_settings_in_extension_menu);
    updateSwitch('#alternate_switch', USER.tableBaseSetting.alternate_switch);
    updateSwitch('#show_drawer_in_extension_list', USER.tableBaseSetting.show_drawer_in_extension_list);
    updateSwitch('#table_to_chat_can_edit', USER.tableBaseSetting.table_to_chat_can_edit);
    $('#reply_options').toggle(!USER.tableBaseSetting.step_by_step);
    $('#step_by_step_options').toggle(USER.tableBaseSetting.step_by_step);
    $('#table_to_chat_options').toggle(USER.tableBaseSetting.isTableToChat);
    $('#table_to_chat_is_micro_d').toggle(USER.tableBaseSetting.table_to_chat_mode === 'macro');
    console.log("设置已渲染")
}

export function loadSettings() {
    USER.IMPORTANT_USER_PRIVACY_DATA = USER.IMPORTANT_USER_PRIVACY_DATA || {};
    if (USER.tableBaseSetting.updateIndex < 3) {
        USER.getSettings().message_template = USER.tableBaseDefaultSettings.message_template
        USER.tableBaseSetting.to_chat_container = USER.tableBaseDefaultSettings.to_chat_container
        USER.tableBaseSetting.updateIndex = 3
    }
    console.log("updateIndex", USER.tableBaseSetting.updateIndex)
    if (USER.tableBaseSetting.updateIndex < 4) {
        initTableStructureToTemplate()
        USER.tableBaseSetting.updateIndex = 4
    }
    if (USER.tableBaseSetting.updateIndex < 5) {
        USER.tableBaseSetting.tableStructure = JSON.parse(JSON.stringify(USER.tableBaseDefaultSettings.tableStructure));
        initTableStructureToTemplate();
        USER.tableBaseSetting.updateIndex = 5;
    }
    if (USER.tableBaseSetting.updateIndex < 6) {
        USER.tableBaseSetting.message_template = USER.tableBaseDefaultSettings.message_template;
        USER.tableBaseSetting.refresh_system_message_template = USER.tableBaseDefaultSettings.refresh_system_message_template;
        USER.tableBaseSetting.refresh_user_message_template = USER.tableBaseDefaultSettings.refresh_user_message_template;
        USER.tableBaseSetting.tableStructure = JSON.parse(JSON.stringify(USER.tableBaseDefaultSettings.tableStructure));
        initTableStructureToTemplate();
        USER.tableBaseSetting.updateIndex = 6;
        USER.saveSettings();
        console.log('[World Memory] 已迁移到六表动态记忆配置 v6');
    }
    if (USER.tableBaseSetting.deep < 0) formatDeep()
    renderSetting();
    InitBinging();
    initRefreshTypeSelector();
    updateTableView();
    getSheetsCellStyle()
}

export function initTableStructureToTemplate() {
    const sheetDefaultTemplates = USER.tableBaseSetting.tableStructure
    USER.getSettings().table_selected_sheets = []
    USER.getSettings().table_database_templates = [];
    for (let defaultTemplate of sheetDefaultTemplates) {
        const newTemplate = new BASE.SheetTemplate()
        newTemplate.domain = 'global'
        newTemplate.createNewTemplate(defaultTemplate.columns.length + 1, 1, false)
        newTemplate.name = defaultTemplate.tableName
        defaultTemplate.columns.forEach((column, index) => {
            newTemplate.findCellByPosition(0, index + 1).data.value = column
        })
        newTemplate.enable = defaultTemplate.enable
        newTemplate.tochat = defaultTemplate.tochat
        newTemplate.required = defaultTemplate.Required
        newTemplate.triggerSend = defaultTemplate.triggerSend
        newTemplate.triggerSendDeep = defaultTemplate.triggerSendDeep
        if(defaultTemplate.config)
            newTemplate.config = JSON.parse(JSON.stringify(defaultTemplate.config))
        newTemplate.source.data.note = defaultTemplate.note
        newTemplate.source.data.initNode = defaultTemplate.initNode
        newTemplate.source.data.deleteNode = defaultTemplate.deleteNode
        newTemplate.source.data.updateNode = defaultTemplate.updateNode
        newTemplate.source.data.insertNode = defaultTemplate.insertNode
        USER.getSettings().table_selected_sheets.push(newTemplate.uid)
        newTemplate.save()
    }
    USER.saveSettings()
}

function templateToTableStructure() {
    const tableTemplates = BASE.templates.map((templateData, index) => {
        const template = new BASE.SheetTemplate(templateData.uid)
        return {
            tableIndex: index,
            tableName: template.name,
            columns: template.hashSheet[0].slice(1).map(cellUid => template.cells.get(cellUid).data.value),
            note: template.data.note,
            initNode: template.data.initNode,
            deleteNode: template.data.deleteNode,
            updateNode: template.data.updateNode,
            insertNode: template.data.insertNode,
            config: JSON.parse(JSON.stringify(template.config)),
            Required: template.required,
            tochat: template.tochat,
            enable: template.enable,
            triggerSend: template.triggerSend,
            triggerSendDeep: template.triggerSendDeep,
        }
    })
    USER.tableBaseSetting.tableStructure = tableTemplates
    USER.saveSettings()
}

export function refreshRebuildTemplate() {
    const templateSelect = $('#rebuild--select');
    templateSelect.empty();
    const defaultOption = $('<option>', {
        value: "rebuild_base",
        text: "默认",
    });
    templateSelect.append(defaultOption);
    Object.keys(USER.tableBaseSetting.rebuild_message_template_list).forEach(key => {
        const option = $('<option>', { value: key, text: key });
        templateSelect.append(option);
    });
    if (USER.tableBaseSetting.lastSelectedTemplate) {
        console.log("默认", USER.tableBaseSetting.lastSelectedTemplate)
        $('#rebuild--select').val(USER.tableBaseSetting.lastSelectedTemplate);
    }
}
