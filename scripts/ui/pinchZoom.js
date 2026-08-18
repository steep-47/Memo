// 仅负责数据页横线以下记忆表格的移动端双指缩放。
// 不修改表格数据，不依赖核心记忆逻辑。

const MIN_SCALE = 0.6;
const MAX_SCALE = 2.0;

let activeArea = null;
let startDistance = 0;
let startScale = 1;
let currentScale = 1;

function distance(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.hypot(dx, dy);
}

function findArea(target) {
    return target?.closest?.('#contentContainer.memory-table-pinch-area') || null;
}

function applyScale(area, scale) {
    const tableContainer = area?.querySelector?.('#tableContainer');
    if (!tableContainer) return;

    currentScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
    tableContainer.style.zoom = String(currentScale);
    tableContainer.dataset.memoryPinchScale = String(currentScale);
}

function onTouchStart(event) {
    if (event.touches.length !== 2) return;

    const area = findArea(event.target);
    if (!area) return;

    activeArea = area;
    startDistance = distance(event.touches);

    const tableContainer = area.querySelector('#tableContainer');
    const savedScale = Number(tableContainer?.dataset?.memoryPinchScale || currentScale || 1);
    startScale = Number.isFinite(savedScale) ? savedScale : 1;
}

function onTouchMove(event) {
    if (!activeArea || event.touches.length !== 2 || startDistance <= 0) return;

    const nextDistance = distance(event.touches);
    const ratio = nextDistance / startDistance;
    applyScale(activeArea, startScale * ratio);

    // 只有双指缩放时阻止上层页面接管；单指滚动不受影响。
    event.preventDefault();
    event.stopPropagation();
}

function finishPinch(event) {
    if (!event || event.touches.length < 2) {
        activeArea = null;
        startDistance = 0;
    }
}

// capture=true：尽量先于 SillyTavern 上层触摸处理器收到事件。
document.addEventListener('touchstart', onTouchStart, { passive: true, capture: true });
document.addEventListener('touchmove', onTouchMove, { passive: false, capture: true });
document.addEventListener('touchend', finishPinch, { passive: true, capture: true });
document.addEventListener('touchcancel', finishPinch, { passive: true, capture: true });

console.log('[世界状态记忆表格] 表格双指缩放模块已加载');
