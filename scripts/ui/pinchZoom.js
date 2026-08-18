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
const areaResizeObserver = new ResizeObserver(() => requestAnimationFrame(refreshVisibleArea));

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

function normalizeHeader(text) {
    return String(text || '').replace(/\s+/g, '').trim();
}

function cloneTableColumns(source, indices, indexColumn = -1, bodyRowIndex = null) {
    const clone = source.cloneNode(false);
    clone.removeAttribute('id');
    clone.classList.remove('memory-role-status-source');

    for (const section of Array.from(source.children)) {
        if (!['THEAD', 'TBODY', 'TFOOT'].includes(section.tagName)) continue;
        const sectionClone = section.cloneNode(false);
        const rows = Array.from(section.rows || []);
        const rowsToClone = section.tagName === 'TBODY' && bodyRowIndex !== null
            ? (rows[bodyRowIndex] ? [rows[bodyRowIndex]] : [])
            : rows;

        for (const row of rowsToClone) {
            const rowClone = row.cloneNode(false);
            const cells = Array.from(row.cells || []);

            if (indexColumn >= 0 && cells[indexColumn]) {
                rowClone.appendChild(cells[indexColumn].cloneNode(true));
            }
            for (const index of indices) {
                if (index === indexColumn) continue;
                if (cells[index]) rowClone.appendChild(cells[index].cloneNode(true));
            }
            sectionClone.appendChild(rowClone);
        }
        if (sectionClone.children.length) clone.appendChild(sectionClone);
    }
    return clone;
}

function splitRoleStatusTable() {
    const container = document.querySelector('#tableContainer');
    if (!container) return;

    for (const oldView of container.querySelectorAll('.memory-role-status-three-rows')) oldView.remove();
    for (const oldSource of container.querySelectorAll('.memory-role-status-source')) oldSource.classList.remove('memory-role-status-source');

    const headings = Array.from(container.querySelectorAll('h1,h2,h3,h4,h5,h6'));
    const roleHeading = headings.find(el => /#?1\s*角色状态表/.test(normalizeHeader(el.textContent)) || normalizeHeader(el.textContent) === '角色状态表');
    if (!roleHeading) return;

    let node = roleHeading.nextElementSibling;
    let source = null;
    while (node) {
        if (/^H[1-6]$/.test(node.tagName)) break;
        if (node.tagName === 'TABLE') { source = node; break; }
        source = node.querySelector?.('table') || null;
        if (source) break;
        node = node.nextElementSibling;
    }
    if (!source) return;

    const headerRow = source.querySelector('thead tr') || source.querySelector('tr');
    if (!headerRow) return;

    const headers = Array.from(headerRow.cells).map(cell => normalizeHeader(cell.textContent));
    if (headers.length < 3) return;
    const indexColumn = headers[0] === '' ? 0 : -1;

    const name = headers.findIndex(h => h === '姓名');
    const spiritRoot = headers.findIndex(h => h.includes('灵根') || h.includes('体质'));
    const spiritPower = headers.findIndex(h => h === '灵力' || h.includes('灵力'));
    const money = headers.findIndex(h => h.includes('钱财'));
    const skills = headers.findIndex(h => h.includes('技能') || h.includes('术法'));

    if (name < 0 || spiritRoot < 0 || spiritPower < 0 || money < 0 || skills < 0) return;
    if (!(name <= spiritRoot && spiritRoot < spiritPower && spiritPower <= money && money < skills)) return;

    const groups = [
        Array.from({ length: spiritRoot - name + 1 }, (_, i) => name + i),
        Array.from({ length: money - spiritPower + 1 }, (_, i) => spiritPower + i),
        Array.from({ length: headers.length - skills }, (_, i) => skills + i),
    ];

    const bodyRows = Array.from(source.tBodies?.[0]?.rows || []);
    const view = document.createElement('div');
    view.className = 'memory-role-status-three-rows memory-role-status-by-character';

    // 按人物分块：同一个人物的三组字段连续显示，再进入下一个人物。
    bodyRows.forEach((_, rowIndex) => {
        const block = document.createElement('div');
        block.className = 'memory-role-status-character-block';
        for (const group of groups) {
            block.appendChild(cloneTableColumns(source, group, indexColumn, rowIndex));
        }
        view.appendChild(block);
    });

    // 空表仍显示三组表头，避免角色表完全消失。
    if (!bodyRows.length) {
        const block = document.createElement('div');
        block.className = 'memory-role-status-character-block';
        for (const group of groups) block.appendChild(cloneTableColumns(source, group, indexColumn));
        view.appendChild(block);
    }

    source.classList.add('memory-role-status-source');
    const host = source.parentElement;
    if (host && host !== container && host.children.length === 1) host.after(view);
    else source.after(view);
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
    const nodes = tableContainer.querySelectorAll('*:not(.memory-role-status-source):not(.memory-role-status-source *)');
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
    const visualOverflow = Math.max(0, canvasWidth * currentScale - area.clientWidth);
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
        const ratio = distance(event.touches) / startDistance;
        applyScale(activeArea, startScale * ratio);
        event.preventDefault();
        event.stopPropagation();
        return;
    }
    if (event.touches.length !== 1 || !panArea) return;
    const dx = event.touches[0].clientX - panStartX;
    const dy = event.touches[0].clientY - panStartY;
    if (!horizontalPanning) {
        if (Math.abs(dx) < HORIZONTAL_THRESHOLD && Math.abs(dy) < HORIZONTAL_THRESHOLD) return;
        if (Math.abs(dx) <= Math.abs(dy)) { panArea = null; return; }
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

let refreshQueued = false;
function refreshVisibleArea() {
    if (refreshQueued) return;
    refreshQueued = true;
    requestAnimationFrame(() => {
        refreshQueued = false;
        splitRoleStatusTable();
        const area = getVisibleArea();
        if (!hasUsableWidth(area)) return;
        keepDrawerFilled(area);
        syncWholeCanvasWidth(area);
        applyPan(area, panOffset);
    });
}

const mutationObserver = new MutationObserver(() => refreshVisibleArea());
mutationObserver.observe(document.documentElement, { childList: true, subtree: true });

requestAnimationFrame(refreshVisibleArea);
setTimeout(refreshVisibleArea, 250);
setTimeout(refreshVisibleArea, 600);

document.addEventListener('touchstart', onTouchStart, { passive: true, capture: true });
document.addEventListener('touchmove', onTouchMove, { passive: false, capture: true });
document.addEventListener('touchend', finishTouch, { passive: true, capture: true });
document.addEventListener('touchcancel', finishTouch, { passive: true, capture: true });
window.addEventListener('resize', refreshVisibleArea, { passive: true });

console.log('[世界状态记忆表格] 整体缩放、横向拖动与角色按人物三行布局已加载');
