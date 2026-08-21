import './index.js';

const RUNTIME_VERSION = 'memo73';

async function loadOptional(label, path) {
    try {
        await import(`${path}?v=${RUNTIME_VERSION}`);
        console.log(`[Memo][loader] ${label} loaded`);
        return true;
    } catch (error) {
        console.error(`[Memo][loader] ${label} load failed`, error);
        const toast = globalThis?.toastr;
        if (toast?.error) toast.error(`Memo模块加载失败：${label}｜${error?.message || error}`);
        return false;
    }
}

// 核心Memo(index.js)先加载；附加模块彼此隔离。
// 记录链优先，结构迁移/整理/UI失败不得拖死正常记录。
const modules = [
    ['设置归一', './scripts/runtime/settingsBootstrap.js'],
    ['记录模式控制', './scripts/runtime/modeRuntimeControl.js'],
    ['一次API提示恢复', './scripts/runtime/singleApiPromptRestore.js'],
    ['一次API成功提示', './scripts/runtime/singleApiFinish.js'],
    ['一次API诊断', './scripts/runtime/singleApiDiagnostic.js'],
    ['记录API开关', './scripts/ui/apiModeToggle.js'],

    ['七表规则', './scripts/runtime/memoryContentRules.js'],
    ['稳定表格整理', './scripts/runtime/stableTableCleanup.js'],
    ['整理按钮桥接', './scripts/runtime/cleanupButtonBridge.js'],
    ['人物表展示', './scripts/ui/personTableSplit.js'],
    ['双指缩放', './scripts/ui/pinchZoom.js'],
    ['填表状态颜色', './scripts/ui/fillStatusColor.js'],
];

for (const [label, path] of modules) {
    await loadOptional(label, path);
}

console.log('[Memo][loader] memo73 隔离式运行时加载完成');
