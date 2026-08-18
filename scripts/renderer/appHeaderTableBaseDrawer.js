import {EDITOR} from "../../core/manager.js";
import {getChatSheetsView} from "../editor/chatSheetsDataView.js";
import {getEditView} from "../editor/tableTemplateEditView.js";

let tableDrawer = null;
let tableDrawerIcon = null;
let tableDrawerContent = null;
let appHeaderTableContainer = null;
let databaseButton = null;
let settingButton = null;
let inlineDrawerHeaderContent = null;

let tableViewDom = null;
let tableEditDom = null;
let settingContainer = null;
let databaseContentDiv = null;
let settingContentDiv = null;

const timeOut = 200;
const easing = 'easeInOutCubic';
let isEventListenersBound = false;
let currentActiveButton = null;

function updateButtonStates(selectedButton) {
    if (currentActiveButton && currentActiveButton.is(selectedButton)) return false;
    databaseButton.css('opacity', '0.5');
    settingButton.css('opacity', '0.5');
    selectedButton.css('opacity', '1');
    currentActiveButton = selectedButton;
    return true;
}

function buildTemplateDrawer(content) {
    const drawer = $(`
        <div id="settings-template-drawer" class="inline-drawer wide100p" style="margin-top: 8px; margin-bottom: 8px;">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b><span>模板</span></b>
                <div class="fa-solid fa-circle-chevron-down inline-drawer-icon down"></div>
            </div>
            <div class="inline-drawer-content" style="display: none; padding-top: 8px;"></div>
        </div>
    `);
    drawer.find('.inline-drawer-content').append(content);
    return drawer;
}

function setControlsCollapsed(collapsed) {
    tableDrawerContent.toggleClass('table-controls-collapsed', collapsed);
    const button = $('#table_controls_collapse_button');
    const icon = button.find('i');
    icon.toggleClass('fa-chevron-up', !collapsed);
    icon.toggleClass('fa-chevron-down', collapsed);
    button.attr('aria-expanded', String(!collapsed));
    button.attr('title', collapsed ? '展开控制区' : '折叠控制区');
}

function bindControlsCollapse() {
    const button = $('#table_controls_collapse_button');
    if (!button.length || button.data('memory-collapse-bound')) return;

    button.data('memory-collapse-bound', true);
    button.on('click', function(event) {
        event.preventDefault();
        event.stopPropagation();
        setControlsCollapsed(!tableDrawerContent.hasClass('table-controls-collapsed'));
    });
}

export async function initAppHeaderTableDrawer() {
    if (isEventListenersBound) return;

    tableDrawer = $('#table_database_settings_drawer');
    tableDrawerIcon = $('#table_drawer_icon');
    tableDrawerContent = $('#table_drawer_content');
    appHeaderTableContainer = $('#app_header_table_container');
    databaseButton = $('#database_button');
    settingButton = $('#setting_button');
    inlineDrawerHeaderContent = $('#inline_drawer_header_content');

    $('.fa-panorama').removeClass('fa-panorama').addClass('fa-image');
    $('.fa-user-cog').removeClass('fa-user-cog').addClass('fa-user');

    if (tableViewDom === null) tableViewDom = await getChatSheetsView(-1);

    if (tableEditDom === null) {
        tableEditDom = $(`<div class="settings-template-content"></div>`);
        tableEditDom.append(await getEditView(-1));
    }

    if (settingContainer === null) {
        const header = $(`<div></div>`).append($(`<div style="margin: 10px 0;"></div>`).append(inlineDrawerHeaderContent));
        settingContainer = header.append($('.memory_enhancement_container').find('#memory_enhancement_settings_inline_drawer_content'));

        const templateDrawer = buildTemplateDrawer(tableEditDom);
        const contextRow = settingContainer.find('#separateReadContextLayers').closest('.checkbox_label');
        if (contextRow.length) {
            contextRow.after(templateDrawer);
        } else {
            settingContainer.append(templateDrawer);
        }
    }

    databaseContentDiv = $(`<div id="database-content" style="width: 100%; height: 100%; overflow: hidden;"></div>`).append(tableViewDom);
    settingContentDiv = $(`<div id="setting-content" style="width: 100%; height: 100%; display: none; overflow: hidden;"></div>`).append(settingContainer);

    appHeaderTableContainer.append(databaseContentDiv);
    appHeaderTableContainer.append(settingContentDiv);

    updateButtonStates(databaseButton);
    bindControlsCollapse();
    // 数据控制区默认折叠；需要时点击右上角箭头展开。
    setControlsCollapsed(true);

    $('#tableUpdateTag').click(function() {
        $('#extensions_details').trigger('click');
    });

    databaseButton.on('click', function() {
        if (updateButtonStates(databaseButton)) switchContent(databaseContentDiv);
    });

    settingButton.on('click', function() {
        if (updateButtonStates(settingButton)) switchContent(settingContentDiv);
    });

    isEventListenersBound = true;
    $('.memory_enhancement_container').remove();
}

export async function openAppHeaderTableDrawer(target = undefined) {
    if (!isEventListenersBound) await initAppHeaderTableDrawer();

    if (tableDrawerIcon.hasClass('closedIcon')) {
        $('.openDrawer').not('#table_drawer_content').not('.pinnedOpen').addClass('resizing').each((_, el) => {
            EDITOR.slideToggle(el, {
                ...EDITOR.getSlideToggleOptions(),
                onAnimationEnd: function (el) {
                    el.closest('.drawer-content').classList.remove('resizing');
                },
            });
        });
        $('.openIcon').not('#table_drawer_icon').not('.drawerPinnedOpen').toggleClass('closedIcon openIcon');
        $('.openDrawer').not('#table_drawer_content').not('.pinnedOpen').toggleClass('closedDrawer openDrawer');

        tableDrawerIcon.toggleClass('closedIcon openIcon');
        tableDrawerContent.toggleClass('closedDrawer openDrawer');

        tableDrawerContent.addClass('resizing').each((_, el) => {
            EDITOR.slideToggle(el, {
                ...EDITOR.getSlideToggleOptions(),
                onAnimationEnd: function (el) {
                    el.closest('.drawer-content').classList.remove('resizing');
                },
            });
        });

        if (target === 'database') databaseButton.trigger('click');
        if (target === 'setting' || target === 'editor') settingButton.trigger('click');
    } else {
        tableDrawerIcon.toggleClass('openIcon closedIcon');
        tableDrawerContent.toggleClass('openDrawer closedDrawer');
        tableDrawerContent.addClass('resizing').each((_, el) => {
            EDITOR.slideToggle(el, {
                ...EDITOR.getSlideToggleOptions(),
                onAnimationEnd: function (el) {
                    el.closest('.drawer-content').classList.remove('resizing');
                },
            });
        });
    }
}

async function switchContent(targetContent) {
    const currentContent = appHeaderTableContainer.children(':visible');
    if (currentContent.is(targetContent)) return;

    currentContent.stop(true, false);
    targetContent.stop(true, false);

    if (currentContent.length > 0) {
        currentContent.slideUp({ duration: timeOut, easing });
    }
    targetContent.slideDown({ duration: timeOut, easing });
}
