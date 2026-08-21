// 七表结构已经把旧14列“人物表”真实拆成：
// #4 人物主表 + #5 人物发展表。
// 本文件只负责清理旧版本可能残留的虚拟三段人物视图，不再修改或复制任何表格DOM。

function cleanupLegacyVirtualPersonViews() {
    document.querySelectorAll('.memory-person-two-tables').forEach(el => el.remove());
    document.querySelectorAll('.memory-person-source').forEach(el => el.classList.remove('memory-person-source'));
}

cleanupLegacyVirtualPersonViews();
queueMicrotask(cleanupLegacyVirtualPersonViews);
setTimeout(cleanupLegacyVirtualPersonViews, 300);
setTimeout(cleanupLegacyVirtualPersonViews, 1000);

console.log('[Memo] 七表模式：旧人物表虚拟拆分展示已停用');
