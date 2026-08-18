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

function keepDrawerFilled(area) {
    // zoom 会改变表格视觉尺寸。数据面板不能跟着缩短，否则底部会露出聊天正文。
    // 让横线以下区域至少占满当前抽屉剩余的可视高度；内容更高时仍可自然撑开/滚动。
    const drawer = area?.closest?.('#table_drawer_content');
    if (!drawer) return;

    const areaRect = area.getBoundingClientRect();
    const drawerRect = drawer.getBoundingClientRect();
    const remaining = Math.max(0, drawerRect.bottom - areaRect.top);

    area.style.minHeight = `${remaining}px`;
    area.style.boxSizing = 'border-box';
}

function applyScale(area, scale) {
    const tableContainer = area?.querySelector?.('#tableContainer');
    if (!tableContainer) return;

    currentScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
    tableContainer.style.zoom = String(currentScale);
    tableContainer.dataset.memoryPinchScale = String(currentScale);
    keepDrawerFilled(area);
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
    keepDrawerFilled(area);
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
        if (activeArea) keepDrawerFilled(activeArea);
        activeArea = null;
        startDistance = 0;
    }
}

function refreshVisibleAreaHeight() {
    const area = document.querySelector('#contentContainer.memory-table-pinch-area');
    if (area) keepDrawerFilled(area);
}

// capture=true：尽量先于 SillyTavern 上层触摸处理器收到事件。
document.addEventListener('touchstart', onTouchStart, { passive: true, capture: true });
document.addEventListener('touchmove', onTouchMove, { passive: false, capture: true });
document.addEventListener('touchend', finishPinch, { passive: true, capture: true });
document.addEventListener('touchcancel', finishPinch, { passive: true, capture: true });
window.addEventListener('resize', refreshVisibleAreaHeight, { passive: true });

console.log('[世界状态记忆表格] 表格双指缩放模块已加载');
