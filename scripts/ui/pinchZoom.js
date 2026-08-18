// 数据页横线以下：双指缩放 + 单指整体横向拖动。
// #1 角色状态表仅在展示层拆成两个短表；底层数据结构不变。

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
let roleSplitQueued = false;

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

function cleanEmptyCell(cell) {
    if (!cell) return;
    const text = String(cell.textContent || '').trim();
    // 统一把常见“无内容”占位显示为空白；真实数据不改，只改克隆出来的展示单元格。
    if (/^(无|暂无|没有|未知|未记录|未提及|无数据|N\/A|NA|null|undefined|-|—|--|空)$/i.test(text)) {
        cell.textContent = '';
    }
}

function cloneColumns(source, indices, indexColumn = -1) {
    const clone = source.cloneNode(false);
    clone.removeAttribute('id');
    clone.classList.remove('memory-role-status-source');
    clone.classList.add('memory-role-status-half-table');

    for (const section of Array.from(source.children)) {
        if (!['THEAD', 'TBODY', 'TFOOT'].includes(section.tagName)) continue;
        const sectionClone = section.cloneNode(false);
        for (const row of Array.from(section.rows || [])) {
            const rowClone = row.cloneNode(false);
            const cells = Array.from(row.cells || []);
            if (indexColumn >= 0 && cells[indexColumn]) {
                rowClone.appendChild(cells[indexColumn].cloneNode(true));
            }
            for (const index of indices) {
                if (index === indexColumn || !cells[index]) continue;
                const cell = cells[index].cloneNode(true);
                if (section.tagName !== 'THEAD') cleanEmptyCell(cell);
                rowClone.appendChild(cell);
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

    // 每次原表重绘后重新生成展示层，避免旧克隆残留。
    container.querySelectorAll('.memory-role-status-two-tables').forEach(el => el.remove());
    container.querySelectorAll('.memory-role-status-source').forEach(el => el.classList.remove('memory-role-status-source'));

    const headings = Array.from(container.querySelectorAll('h1,h2,h3,h4,h5,h6'));
    const heading = headings.find(el => {
        const text = normalizeHeader(el.textContent);
        return /#?1角色状态表/.test(text) || text === '角色状态表';
    });
    if (!heading) return;

    let node = heading.nextElementSibling;
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
    const indexColumn = headers[0] === '' ? 0 : -1;

    const find = predicate => headers.findIndex(predicate);
    const name = find(h => h === '姓名');
    const spiritSense = find(h => h.includes('神识'));
    const bodyState = find(h => h.includes('身体状态'));
    if (name < 0 || spiritSense < name || bodyState <= spiritSense) return;

    // A：姓名 → 神识
    // B：姓名（重复用于人物识别）+ 身体状态 → 最后字段
    const first = Array.from({ length: spiritSense - name + 1 }, (_, i) => name + i);
    const second = [name, ...Array.from({ length: headers.length - bodyState }, (_, i) => bodyState + i)];

    const view = document.createElement('div');
    view.className = 'memory-role-status-two-tables';
    view.appendChild(cloneColumns(source, first, indexColumn));
    view.appendChild(cloneColumns(source, second, indexColumn));

    source.classList.add('memory-role-status-source');
    const host = source.parentElement;
    if (host && host !== container && host.children.length === 1) host.after(view);
    else source.after(view);
}

function queueRoleSplit() {
    if (roleSplitQueued) return;
    roleSplitQueued = true;
    requestAnimationFrame(() => {
        roleSplitQueued = false;
        splitRoleStatusTable();
    });
}

function keepDrawerFilled(area) {
    if (!hasUsableWidth(area)) return;
    const drawer = area.closest('#table_drawer_content');
    if (!drawer) return;
    const areaRect = area.getBoundingClientRect();
    const drawerRect = drawer.getBoundingClientRect();
    area.style.minHeight = `${Math.max(0, drawerRect.bottom - areaRect.top)}px`;
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
        applyScale(activeArea, startScale * distance(event.touches) / startDistance);
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

function refreshVisibleArea() {
    queueRoleSplit();
    const area = getVisibleArea();
    if (!hasUsableWidth(area)) return;
    keepDrawerFilled(area);
    syncWholeCanvasWidth(area);
    applyPan(area, panOffset);
}

const mutationObserver = new MutationObserver(mutations => {
    // 忽略我们自己生成/删除的展示克隆，避免 MutationObserver 自激循环。
    const external = mutations.some(m => {
        const target = m.target?.nodeType === 1 ? m.target : m.target?.parentElement;
        return !target?.closest?.('.memory-role-status-two-tables');
    });
    if (external) requestAnimationFrame(refreshVisibleArea);
});
mutationObserver.observe(document.documentElement, { childList: true, subtree: true });

requestAnimationFrame(refreshVisibleArea);
setTimeout(refreshVisibleArea, 250);
setTimeout(refreshVisibleArea, 600);

document.addEventListener('touchstart', onTouchStart, { passive: true, capture: true });
document.addEventListener('touchmove', onTouchMove, { passive: false, capture: true });
document.addEventListener('touchend', finishTouch, { passive: true, capture: true });
document.addEventListener('touchcancel', finishTouch, { passive: true, capture: true });
window.addEventListener('resize', refreshVisibleArea, { passive: true });

console.log('[世界状态记忆表格] 整体缩放、横向拖动与角色双表展示已加载');
