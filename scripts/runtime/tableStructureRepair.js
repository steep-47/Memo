// tableStructureRepair.js
import { BASE, EDITOR, USER } from '../../core/manager.js';
import { updateSystemMessageTableStatus } from '../renderer/tablePushToChat.js';

/**
 * 在“表格整理”开始前，用当前预设的标准列修复缺失表头。
 * 只补缺失列；已有列与额外自定义列都会保留，现有数据按列名重新对齐。
 * 不调用 API，不参与普通自动填表链。
 */
function repairMissingColumnsBeforeCleanup() {
    const { piece } = USER.getChatPiece() || {};
    if (!piece) return [];

    const sheets = BASE.getChatSheets().filter(sheet => sheet.enable);
    const structures = Array.isArray(USER.tableBaseSetting.tableStructure)
        ? USER.tableBaseSetting.tableStructure
        : [];

    const repaired = [];

    sheets.forEach((sheet, enabledIndex) => {
        // 先按表名匹配，避免禁用某张表后 enabledIndex 与原 tableIndex 错位。
        const structure = structures.find(item => item.tableName === sheet.name)
            || structures.find(item => item.tableIndex === enabledIndex);
        const standardHeaders = Array.isArray(structure?.columns)
            ? structure.columns.map(v => String(v ?? '').trim()).filter(Boolean)
            : [];
        if (standardHeaders.length === 0) return;

        const currentHeaders = sheet.getHeader().map(v => String(v ?? '').trim());
        const missingHeaders = standardHeaders.filter(header => !currentHeaders.includes(header));
        if (missingHeaders.length === 0) return;

        // 标准列恢复为标准顺序；当前存在的非标准列追加在末尾，避免误删用户自定义字段。
        const extraHeaders = currentHeaders.filter(header => header && !standardHeaders.includes(header));
        const targetHeaders = [...standardHeaders, ...extraHeaders];

        const rows = [];
        for (let rowIndex = 1; rowIndex < sheet.getRowCount(); rowIndex++) {
            const cells = sheet.getCellsByRowIndex(rowIndex) || [];
            const oldValuesByHeader = new Map();
            currentHeaders.forEach((header, colIndex) => {
                if (!header) return;
                oldValuesByHeader.set(header, cells[colIndex + 1]?.data?.value ?? '');
            });
            rows.push(targetHeaders.map(header => oldValuesByHeader.get(header) ?? ''));
        }

        const valueSheet = [
            ['', ...targetHeaders],
            ...rows.map(row => ['', ...row]),
        ];

        sheet.rebuildHashSheetByValueSheet(valueSheet);
        sheet.save(piece, true);
        repaired.push({
            tableIndex: structure?.tableIndex ?? enabledIndex,
            tableName: sheet.name,
            missingHeaders,
        });
    });

    if (repaired.length > 0) {
        BASE.refreshContextView();
        updateSystemMessageTableStatus();
        USER.saveChat();
        console.log('[Memo] 表格整理前已修复缺失表头:', repaired);
        const summary = repaired
            .map(item => `${item.tableName}: ${item.missingHeaders.join('、')}`)
            .join('；');
        EDITOR.success(`已修复缺失表头：${summary}`);
    }

    return repaired;
}

export { repairMissingColumnsBeforeCleanup };
