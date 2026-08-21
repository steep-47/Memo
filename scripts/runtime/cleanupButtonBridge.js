const INSTALL_FLAG = '__memoCleanupButtonBridgeInstalled';

if (!window[INSTALL_FLAG]) {
    window[INSTALL_FLAG] = true;

    document.addEventListener('click', async (event) => {
        const target = event.target?.closest?.('#table_rebuild_button, #table_clear_up');
        if (!target) return;

        // Intercept before chatSheetsDataView's delegated document click handler
        // can call the legacy rebuildSheets() JSON flow.
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        try {
            const module = await import('./stableTableCleanup.js?v=memo61');
            await module.runStableCleanup();
        } catch (error) {
            console.error('[Memo][table-cleanup] cleanup bridge failed:', error);
            const editor = globalThis?.toastr;
            if (editor?.error) editor.error(`表格整理入口加载失败：${error?.message || error}`);
        }
    }, true);

    console.log('[Memo] 表格整理真实按钮桥接已加载：#table_rebuild_button / #table_clear_up');
}
