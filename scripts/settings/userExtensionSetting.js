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

function formatDeep() { USER.tableBaseSetting.deep = Math.abs(USER.tableBaseSetting.deep) }
function updateSwitch(selector, switchValue) { $(selector).prop('checked', !!switchValue); }

function updateTableView() {
    const show_drawer_in_extension_list = USER.tableBaseSetting.show_drawer_in_extension_list;
    const extensionsMenu = document.querySelector('#extensionsMenu');
    if (show_drawer_in_extension_list === true) {
        if (document.querySelector('#drawer_in_extension_list_button')) return
        $(extensionsMenu).append(`<div id="drawer_in_extension_list_button" class="list-group-item flex-container flexGap5 interactable"><div class="fa-solid fa-table extensionsMenuExtensionButton"></div><span>增强记忆表格</span></div>`);
        $('#drawer_in_extension_list_button').on('click', () => { $('#table_drawer_icon').click(); $('#database_button').click(); });
    } else document.querySelector('#drawer_in_extension_list_button')?.remove();
}

function getSheetsCellStyle() {
    const style = document.createElement('style');
    const cellWidth = USER.tableBaseSetting.table_cell_width_mode;
    let holder = document.querySelector('#sheet_cell_style_container');
    if (holder) holder.innerHTML = ''; else { holder = document.createElement('div'); holder.id = 'sheet_cell_style_container'; document.body.appendChild(holder); }
    if (cellWidth === 'wide1_cell') style.innerHTML = ` tr .sheet-cell { max-width: 800px !important; white-space: normal !important; } `;
    else if (cellWidth === 'wide1_2_cell') style.innerHTML = ` tr .sheet-cell { max-width: 400px !important; white-space: normal !important; } `;
    else if (cellWidth === 'wide1_4_cell') style.innerHTML = ` tr .sheet-cell { max-width: 200px !important; white-space: normal !important; } `;
    holder.appendChild(style);
}

async function importTableSet() { EDITOR.warning('当前自用版未启用预设导入'); }
async function exportTableSet() { EDITOR.warning('当前自用版未启用预设导出'); }
async function resetSettings() { EDITOR.warning('当前自用版未启用设置重置'); }

function InitBinging() {
    console.log('初始化绑定');
    $('#table-set-import').on('click', () => importTableSet());
    $('#table-set-export').on('click', () => exportTableSet());
    $('#table-reset').on('click', () => resetSettings());
    $('#table-switch').off('change');
    $('#table_switch').change(function () { USER.tableBaseSetting.isExtensionAble = this.checked; updateSystemMessageTableStatus(); });
    $('#table_switch_debug_mode').change(function () { USER.tableBaseSetting.tableDebugModeAble = this.checked; });
    $('#table_read_switch').change(function () { USER.tableBaseSetting.isAiReadTable = this.checked; });
    $('#table_edit_switch').change(function () { USER.tableBaseSetting.isAiWriteTable = this.checked; });
    $('#dataTable_injection_mode').change(function (event) { USER.tableBaseSetting.injection_mode = event.target.value; });
    $('#fill_table_time').change(function() {
        const step = $(this).val() === 'after';
        $('#reply_options').toggle(!step); $('#step_by_step_options').toggle(step); USER.tableBaseSetting.step_by_step = step; USER.saveSettings?.();
    });
    $('#confirm_before_execution').change(function() { USER.tableBaseSetting.confirm_before_execution = $(this).prop('checked'); });
    $('#ignore_del').change(function() { USER.tableBaseSetting.bool_ignore_del = $(this).prop('checked'); });
    $('#ignore_user_sent').change(function() { USER.tableBaseSetting.ignore_user_sent = $(this).prop('checked'); });
    $('#bool_silent_refresh').change(function() { USER.tableBaseSetting.bool_silent_refresh = $(this).prop('checked'); });
    $('#use_main_api').change(function() { USER.tableBaseSetting.use_main_api = this.checked; });
    $('#step_by_step_use_main_api').change(function() { USER.tableBaseSetting.step_by_step_use_main_api = this.checked; });
    $('#model_selector').change(function(event) { $('#custom_model_name').val(event.target.value); USER.IMPORTANT_USER_PRIVACY_DATA.custom_model_name = event.target.value; USER.saveSettings?.(); });
    $('#table_to_chat').change(function () { USER.tableBaseSetting.isTableToChat = this.checked; $('#table_to_chat_options').toggle(this.checked); updateSystemMessageTableStatus(); });
    $('#show_settings_in_extension_menu').change(function () { USER.tableBaseSetting.show_settings_in_extension_menu = this.checked; updateTableView(); });
    $('#alternate_switch').change(function () { USER.tableBaseSetting.alternate_switch = this.checked; updateTableView(); updateAlternateTable(); });
    $('#show_drawer_in_extension_list').change(function () { USER.tableBaseSetting.show_drawer_in_extension_list = this.checked; updateTableView(); });
    $('#table_to_chat_can_edit').change(function () { USER.tableBaseSetting.table_to_chat_can_edit = this.checked; updateSystemMessageTableStatus(); });
    $('#table_to_chat_mode').change(function(event) { USER.tableBaseSetting.table_to_chat_mode = event.target.value; $('#table_to_chat_is_micro_d').toggle(event.target.value === 'macro'); updateSystemMessageTableStatus(); });
    $('#table_cell_width_mode').change(function(event) { USER.tableBaseSetting.table_cell_width_mode = event.target.value; getSheetsCellStyle(); });
    $('#custom_api_url').on('input', function() { USER.IMPORTANT_USER_PRIVACY_DATA.custom_api_url = $(this).val(); USER.saveSettings?.(); });
    $('#custom_api_key').on('input', function () { try { const result = processApiKey($(this).val(), generateDeviceId()); USER.IMPORTANT_USER_PRIVACY_DATA.custom_api_key = result.encryptedResult.encrypted || result.encryptedResult; USER.saveSettings?.(); } catch (_) {} });
    $('#custom_model_name').on('input', function() { USER.IMPORTANT_USER_PRIVACY_DATA.custom_model_name = $(this).val(); USER.saveSettings?.(); });
    $('#dataTable_message_template').on('input', function () { USER.tableBaseSetting.message_template = $(this).val(); });
    $('#dataTable_deep').on('input', function () { USER.tableBaseSetting.deep = Math.abs($(this).val()); });
    $('#step_by_step_user_prompt').on('input', function() { USER.tableBaseSetting.step_by_step_user_prompt = $(this).val(); });
    $('#separateReadContextLayers').on('input', function() { USER.tableBaseSetting.separateReadContextLayers = Number($(this).val()); });
    $('#separateReadLorebook').change(function() { USER.tableBaseSetting.separateReadLorebook = this.checked; USER.saveSettings?.(); });
    $('#reset_step_by_step_user_prompt').on('click', function() { const v = USER.tableBaseDefaultSettings.step_by_step_user_prompt; $('#step_by_step_user_prompt').val(v); USER.tableBaseSetting.step_by_step_user_prompt = v; });
    $('#clear_up_stairs').on('input', function() { USER.tableBaseSetting.clear_up_stairs = Number($(this).val()); });
    $('#rebuild_token_limit').on('input', function() { USER.tableBaseSetting.rebuild_token_limit_value = Number($(this).val()); });
    $('#custom_temperature').on('input', function() { USER.tableBaseSetting.custom_temperature = Number($(this).val()); $('#custom_temperature_value').text($(this).val()); });
    $('#table_proxy_address').on('input', function() { USER.IMPORTANT_USER_PRIVACY_DATA.table_proxy_address = $(this).val(); USER.saveSettings?.(); });
    $('#table_proxy_key').on('input', function() { USER.IMPORTANT_USER_PRIVACY_DATA.table_proxy_key = $(this).val(); USER.saveSettings?.(); });
    $('#fetch_models_button').on('click', updateModelList);
    $(document).on('click', '#table_test_api_button', async () => handleApiTestRequest($('#custom_api_url').val(), USER.IMPORTANT_USER_PRIVACY_DATA.custom_api_key, $('#custom_model_name').val()));
    $('#table_clear_up').on('click', () => rebuildSheets());
    $('#dataTable_to_chat_button').on('click', async () => customSheetsStylePopup());
    $('#rebuild--set-rename').on('click', modifyRebuildTemplate); $('#rebuild--set-new').on('click', newRebuildTemplate); $('#rebuild--set-delete').on('click', deleteRebuildTemplate); $('#rebuild--set-export').on('click', exportRebuildTemplate); $('#rebuild--set-import').on('click', importRebuildTemplate);
    $('#rebuild--select').on('change', function() { USER.tableBaseSetting.lastSelectedTemplate = $(this).val(); USER.saveSettings?.(); });
    $(document).on('click', '#trigger_step_by_step_button', () => triggerStepByStepNow());
}

export function renderSetting() {
    $(`#dataTable_injection_mode option[value="${USER.tableBaseSetting.injection_mode}"]`).prop('selected', true);
    $('#dataTable_message_template').val(USER.tableBaseSetting.message_template); $('#dataTable_deep').val(USER.tableBaseSetting.deep);
    $('#clear_up_stairs').val(USER.tableBaseSetting.clear_up_stairs); $('#rebuild_token_limit').val(USER.tableBaseSetting.rebuild_token_limit_value); $('#custom_temperature').val(USER.tableBaseSetting.custom_temperature); $('#custom_temperature_value').text(USER.tableBaseSetting.custom_temperature);
    $('#step_by_step_user_prompt').val(USER.tableBaseSetting.step_by_step_user_prompt || ''); $('#separateReadContextLayers').val(USER.tableBaseSetting.separateReadContextLayers);
    updateSwitch('#separateReadLorebook', USER.tableBaseSetting.separateReadLorebook); $('#fill_table_time').val(USER.tableBaseSetting.step_by_step ? 'after' : 'chat'); refreshRebuildTemplate();
    $('#custom_api_url').val(USER.IMPORTANT_USER_PRIVACY_DATA.custom_api_url || ''); $('#custom_api_key').val(USER.IMPORTANT_USER_PRIVACY_DATA.custom_api_key || ''); $('#custom_model_name').val(USER.IMPORTANT_USER_PRIVACY_DATA.custom_model_name || '');
    updateSwitch('#table_switch', USER.tableBaseSetting.isExtensionAble); updateSwitch('#table_switch_debug_mode', USER.tableBaseSetting.tableDebugModeAble); updateSwitch('#table_read_switch', USER.tableBaseSetting.isAiReadTable); updateSwitch('#table_edit_switch', USER.tableBaseSetting.isAiWriteTable); updateSwitch('#step_by_step_use_main_api', USER.tableBaseSetting.step_by_step_use_main_api);
    $('#reply_options').toggle(!USER.tableBaseSetting.step_by_step); $('#step_by_step_options').toggle(USER.tableBaseSetting.step_by_step);
}

export function loadSettings() {
    USER.IMPORTANT_USER_PRIVACY_DATA = USER.IMPORTANT_USER_PRIVACY_DATA || {};
    if (USER.tableBaseSetting.deep < 0) formatDeep();
    renderSetting(); InitBinging(); initRefreshTypeSelector(); updateTableView(); getSheetsCellStyle();
}

export function initTableStructureToTemplate() {
    const sheetDefaultTemplates = USER.tableBaseSetting.tableStructure; USER.getSettings().table_selected_sheets = []; USER.getSettings().table_database_templates = [];
    for (let defaultTemplate of sheetDefaultTemplates) {
        const newTemplate = new BASE.SheetTemplate(); newTemplate.domain = 'global'; newTemplate.createNewTemplate(defaultTemplate.columns.length + 1, 1, false); newTemplate.name = defaultTemplate.tableName;
        defaultTemplate.columns.forEach((column, index) => { newTemplate.findCellByPosition(0, index + 1).data.value = column });
        newTemplate.enable = defaultTemplate.enable; newTemplate.tochat = defaultTemplate.tochat; newTemplate.required = defaultTemplate.Required; newTemplate.source.data.note = defaultTemplate.note; newTemplate.source.data.initNode = defaultTemplate.initNode; newTemplate.source.data.deleteNode = defaultTemplate.deleteNode; newTemplate.source.data.updateNode = defaultTemplate.updateNode; newTemplate.source.data.insertNode = defaultTemplate.insertNode;
        USER.getSettings().table_selected_sheets.push(newTemplate.uid); newTemplate.save();
    }
    USER.saveSettings();
}

function templateToTableStructure() { return USER.tableBaseSetting.tableStructure; }
export function refreshRebuildTemplate() { const s = $('#rebuild--select'); if (!s.length) return; if (!s.children().length) s.append($('<option>', {value:'rebuild_base', text:'默认'})); }
