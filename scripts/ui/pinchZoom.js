// 数据页横线以下：双指缩放 + 单指整体横向拖动。
// 不修改表格数据，不依赖核心记忆逻辑。

const MIN_SCALE = 0.6;
const MAX_SCALE = 2.0;
const HORIZONTAL_THRESHOLD = 8;
const MIN_VALID_WIDTH = 80;

let activeArea = null;
let startDistance = 0;
let startScale = 1;
let currentScale = 1;

let panArea = null;
let panStartX = 0;
let panStartY = 0;
let panStartOffset = 0;
let panOffset = 0;
let horizontalPanning = false;

let observedArea = null;
const areaResizeObserver = new ResizeObserver(() => {
    requestAnimationFrame(refreshVisibleArea);
});

function distance(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.hypot(dx, dy);
}

function findArea(target) {
    return target?.closest?.('#contentContainer.memory-table-pinch-area') || null;
}

function getVisibleArea() {
    const area = document.querySelector('#contentContainer.memory-table-pinch-area');
    if (!area) return null;

    if (observedArea !== area) {
        if (observedArea) areaResizeObserver.unobserve(observedArea);
        observedArea = area;
        areaResizeObserver.observe(area);
    }

    return area;
}

function hasUsableWidth(area) {
    return !!area && area.clientWidth >= MIN_VALID_WIDTH && area.getClientRects().length > 0;
}

function keepDrawerFilled(area) {
    if (!hasUsableWidth(area)) return;

    const drawer = area.closest('#table_drawer_content');
    if (!drawer) return;

    const areaRect = area.getBoundingClientRect();
    const drawerRect = drawer.getBoundingClientRect();
    const remaining = Math.max(0, drawerRect.bottom - areaRect.top);

    area.style.minHeight = `${remaining}px`;
    area.style.boxSizing = 'border-box';
}

function measureTrueContentWidth(area) {
    const tableContainer = area?.querySelector?.('#tableContainer');
    if (!tableContainer || !hasUsableWidth(area)) return 0;

    let widest = Math.max(tableContainer.scrollWidth, area.clientWidth);
    const nodes = tableContainer.querySelectorAll('*');

    for (const node of nodes) {
        const sw = Number(node.scrollWidth) || 0;
        const rectWidth = node.getBoundingClientRect?.().width || 0;
        const logicalRectWidth = currentScale > 0 ? rectWidth / currentScale : rectWidth;
        widest = Math.max(widest, sw, logicalRectWidth);
    }

    return Math.ceil(widest);
}

function syncWholeCanvasWidth(area) {
    const tableContainer = area?.querySelector?.('#tableContainer');
    if (!tableContainer || !hasUsableWidth(area)) return false;

    const trueWidth = measureTrueContentWidth(area);
    const viewportLogicalWidth = currentScale > 0 ? area.clientWidth / currentScale : area.clientWidth;
    const canvasWidth = Math.max(trueWidth, viewportLogicalWidth);

    if (!Number.isFinite(canvasWidth) || canvasWidth < MIN_VALID_WIDTH) return false;

    tableContainer.style.width = `${canvasWidth}px`;
    tableContainer.style.maxWidth = 'none';
    tableContainer.dataset.memoryCanvasWidth = String(canvasWidth);
    return true;
}

function getMaxPan(area) {
    const tableContainer = area?.querySelector?.('#tableContainer');
    if (!tableContainer || !syncWholeCanvasWidth(area)) return 0;

    const canvasWidth = Number(tableContainer.dataset.memoryCanvasWidth || tableContainer.scrollWidth || 0);
    const visualContentWidth = canvasWidth * currentScale;
    const viewportWidth = area.clientWidth;
    const visualOverflow = Math.max(0, visualContentWidth - viewportWidth);

    return currentScale > 0 ? visualOverflow / currentScale : visualOverflow;
}

function applyPan(area, offset) {
    const tableContainer = area?.querySelector?.('#tableContainer');
    if (!tableContainer || !hasUsableWidth(area)) return;

    const maxPan = getMaxPan(area);
    panOffset = Math.max(-maxPan, Math.min(0, offset));
    tableContainer.style.transform = `translate3d(${panOffset}px, 0, 0)`;
    tableContainer.dataset.memoryPanX = String(panOffset);
}

function applyScale(area, scale) {
    const tableContainer = area?.querySelector?.('#tableContainer');
    if (!tableContainer || !hasUsableWidth(area)) return;

    currentScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
    tableContainer.style.zoom = String(currentScale);
    tableContainer.dataset.memoryPinchScale = String(currentScale);

    syncWholeCanvasWidth(area);
    applyPan(area, panOffset);
    keepDrawerFilled(area);
}

function onTouchStart(event) {
    const area = findArea(event.target);
    if (!area || !hasUsableWidth(area)) return;

    if (event.touches.length === 2) {
        activeArea = area;
        startDistance = distance(event.touches);

        const tableContainer = area.querySelector('#tableContainer');
        const savedScale = Number(tableContainer?.dataset?.memoryPinchScale || currentScale || 1);
        startScale = Number.isFinite(savedScale) ? savedScale : 1;

        horizontalPanning = false;
        panArea = null;
        syncWholeCanvasWidth(area);
        keepDrawerFilled(area);
        return;
    }

    if (event.touches.length === 1) {
        panArea = area;
        panStartX = event.touches[0].clientX;
        panStartY = event.touches[0].clientY;

        const tableContainer = area.querySelector('#tableContainer');
        const savedPan = Number(tableContainer?.dataset?.memoryPanX || panOffset || 0);
        panStartOffset = Number.isFinite(savedPan) ? savedPan : 0;
        horizontalPanning = false;
        syncWholeCanvasWidth(area);
    }
}

function onTouchMove(event) {
    if (event.touches.length === 2 && activeArea && startDistance > 0) {
        const nextDistance = distance(event.touches);
        const ratio = nextDistance / startDistance;
        applyScale(activeArea, startScale * ratio);

        event.preventDefault();
        event.stopPropagation();
        return;
    }

    if (event.touches.length !== 1 || !panArea) return;

    const x = event.touches[0].clientX;
    const y = event.touches[0].clientY;
    const dx = x - panStartX;
    const dy = y - panStartY;

    if (!horizontalPanning) {
        if (Math.abs(dx) < HORIZONTAL_THRESHOLD && Math.abs(dy) < HORIZONTAL_THRESHOLD) return;

        if (Math.abs(dx) <= Math.abs(dy)) {
            panArea = null;
            return;
        }
        horizontalPanning = true;
    }

    applyPan(panArea, panStartOffset + dx / currentScale);
    event.preventDefault();
    event.stopPropagation();
}

function finishTouch(event) {
    if (!event || event.touches.length < 2) {
        if (activeArea) keepDrawerFilled(activeArea);
        activeArea = null;
        startDistance = 0;
    }

    if (!event || event.touches.length === 0) {
        panArea = null;
        horizontalPanning = false;
    }
}

function refreshVisibleArea() {
    const area = getVisibleArea();
    if (!hasUsableWidth(area)) return;

    keepDrawerFilled(area);
    syncWholeCanvasWidth(area);
    applyPan(area, panOffset);
}

// 表格数据刷新后重新测量；真正的尺寸变化交给 ResizeObserver。
const mutationObserver = new MutationObserver(() => {
    requestAnimationFrame(refreshVisibleArea);
});
mutationObserver.observe(document.documentElement, { childList: true, subtree: true });

// 首次加载和抽屉展开时都尝试初始化，ResizeObserver 会在宽度有效后完成最终校正。
requestAnimationFrame(refreshVisibleArea);
setTimeout(refreshVisibleArea, 250);
setTimeout(refreshVisibleArea, 600);

document.addEventListener('touchstart', onTouchStart, { passive: true, capture: true });
document.addEventListener('touchmove', onTouchMove, { passive: false, capture: true });
document.addEventListener('touchend', finishTouch, { passive: true, capture: true });
document.addEventListener('touchcancel', finishTouch, { passive: true, capture: true });
window.addEventListener('resize', refreshVisibleArea, { passive: true });

console.log('[世界状态记忆表格] 整体缩放与横向拖动模块已加载');
