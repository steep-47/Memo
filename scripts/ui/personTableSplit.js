// #4 人物表仅在展示层拆成三张短表；底层14列人物表结构和数据保持不变。
// 第一张：姓名｜性别｜身份/所属｜修为｜主要能力
// 第二张：姓名｜当前地点｜年龄/最后确认时间｜当前状态｜主要目标/重要事项｜与玩家关系
// 第三张：姓名｜别名/称呼｜外貌特征｜性格｜重要信息

let refreshQueued = false;
const normalizeHeader = text => String(text || '').replace(/\s+/g, '').trim();
const EMPTY_VALUE_RE = /^(无|暂无|没有|未知|未记录|未提及|无数据|N\/A|NA|null|undefined|-|—|--|空)$/i;
function cleanEmptyCell(cell) { if (cell && EMPTY_VALUE_RE.test(String(cell.textContent || '').trim())) cell.textContent = ''; }
function getPersonSource(container) {
    const heading = Array.from(container.querySelectorAll('h1,h2,h3,h4,h5,h6')).find(el => /#?4人物表/.test(normalizeHeader(el.textContent)) || normalizeHeader(el.textContent) === '人物表');
    if (!heading) return null;
    let node = heading.nextElementSibling;
    while (node) { if (/^H[1-6]$/.test(node.tagName)) break; if (node.tagName === 'TABLE') return node; const nested = node.querySelector?.('table'); if (nested) return nested; node = node.nextElementSibling; }
    return null;
}
function sourceSignature(source) { return Array.from(source.rows || []).map(row => Array.from(row.cells || []).map(cell => cell.textContent || '').join('\u001f')).join('\u001e'); }
function rowHasPersonName(row, nameColumn, headerRow) {
    if (row === headerRow) return true;
    const cell = row.cells?.[nameColumn];
    if (!cell) return false;
    const text = String(cell.textContent || '').replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
    return text !== '' && !EMPTY_VALUE_RE.test(text);
}
function appendVirtualCell(rowClone, isHeaderRow, text, templateCell) {
    const cell = templateCell ? templateCell.cloneNode(true) : document.createElement(isHeaderRow ? 'th' : 'td');
    cell.removeAttribute('id'); cell.textContent = isHeaderRow ? text : ''; rowClone.appendChild(cell);
}
function cloneColumns(source, descriptors, indexColumn, headerRow, nameColumn) {
    const wrapper = document.createElement('div'); wrapper.className = 'memory-person-half';
    const table = source.cloneNode(false); table.removeAttribute('id'); table.classList.remove('memory-person-source'); table.classList.add('memory-person-half-table');
    for (const section of Array.from(source.children)) {
        if (!['THEAD','TBODY','TFOOT'].includes(section.tagName)) continue;
        const sectionClone = section.cloneNode(false);
        for (const row of Array.from(section.rows || [])) {
            if (!rowHasPersonName(row, nameColumn, headerRow)) continue;
            const rowClone = row.cloneNode(false), cells = Array.from(row.cells || []), isHeaderRow = row === headerRow;
            const templateCell = cells.find((cell, index) => index !== indexColumn && !!cell) || null;
            if (indexColumn >= 0 && cells[indexColumn]) rowClone.appendChild(cells[indexColumn].cloneNode(true));
            for (const descriptor of descriptors) {
                if (descriptor.virtual) { appendVirtualCell(rowClone, isHeaderRow, descriptor.name, templateCell); continue; }
                if (descriptor.index === indexColumn || descriptor.index < 0 || !cells[descriptor.index]) continue;
                const cell = cells[descriptor.index].cloneNode(true); if (!isHeaderRow) cleanEmptyCell(cell); rowClone.appendChild(cell);
            }
            sectionClone.appendChild(rowClone);
        }
        if (sectionClone.children.length) table.appendChild(sectionClone);
    }
    wrapper.appendChild(table); return wrapper;
}
function splitPersonTable() {
    const container = document.querySelector('#tableContainer'); if (!container) return;
    const source = getPersonSource(container); if (!source) return;
    const headerRow = source.querySelector('thead tr') || source.querySelector('tr'); if (!headerRow) return;
    const headers = Array.from(headerRow.cells).map(cell => normalizeHeader(cell.textContent));
    const indexColumn = headers[0] === '' ? 0 : -1, indexOf = name => headers.findIndex(h => h === name);
    const required = ['姓名','身份/所属','修为','外貌特征','性格','与玩家关系','当前状态','重要信息'];
    const positions = Object.fromEntries(required.map(name => [name, indexOf(name)]));
    if (required.some(name => positions[name] < 0)) { source.classList.remove('memory-person-source'); container.querySelectorAll('.memory-person-two-tables').forEach(el => el.remove()); return; }

    const optional = name => {
        const index = indexOf(name);
        return index >= 0 ? {name, index} : {name, index:-1, virtual:true};
    };
    const alias = optional('别名/称呼');
    const gender = optional('性别');
    const location = optional('当前地点');
    const anchorTime = optional('年龄/最后确认时间');
    const ability = optional('主要能力');
    const goal = optional('主要目标/重要事项');

    const firstGroup = [
        {name:'姓名', index:positions['姓名']}, gender,
        {name:'身份/所属', index:positions['身份/所属']},
        {name:'修为', index:positions['修为']}, ability
    ];
    const secondGroup = [
        {name:'姓名', index:positions['姓名']}, location, anchorTime,
        {name:'当前状态', index:positions['当前状态']}, goal,
        {name:'与玩家关系', index:positions['与玩家关系']}
    ];
    const thirdGroup = [
        {name:'姓名', index:positions['姓名']}, alias,
        {name:'外貌特征', index:positions['外貌特征']},
        {name:'性格', index:positions['性格']},
        {name:'重要信息', index:positions['重要信息']}
    ];

    source.classList.add('memory-person-source');
    const signature = `${sourceSignature(source)}|anchors:${['当前地点','年龄/最后确认时间','主要能力','主要目标/重要事项'].map(name => indexOf(name) >= 0 ? 1 : 0).join('')}`;
    let view = container.querySelector('.memory-person-two-tables'); if (view?.dataset?.sourceSignature === signature) return;
    const nextView = document.createElement('div'); nextView.className = 'memory-person-two-tables'; nextView.dataset.sourceSignature = signature;
    nextView.appendChild(cloneColumns(source, firstGroup, indexColumn, headerRow, positions['姓名']));
    nextView.appendChild(cloneColumns(source, secondGroup, indexColumn, headerRow, positions['姓名']));
    nextView.appendChild(cloneColumns(source, thirdGroup, indexColumn, headerRow, positions['姓名']));
    if (view) view.replaceWith(nextView); else { const host = source.parentElement; if (host && host !== container && host.children.length === 1) host.after(nextView); else source.after(nextView); }
    container.querySelectorAll('.memory-person-two-tables').forEach(el => { if (el !== nextView) el.remove(); });
}
function queueRefresh() { if (refreshQueued) return; refreshQueued = true; requestAnimationFrame(() => { refreshQueued = false; splitPersonTable(); }); }
function mutationIsOnlyPersonView(mutation) { const nodes = [...mutation.addedNodes, ...mutation.removedNodes]; return nodes.length > 0 && nodes.every(node => node.nodeType === 1 && node.matches?.('.memory-person-two-tables')); }
const observer = new MutationObserver(mutations => { if (!mutations.every(mutationIsOnlyPersonView)) queueRefresh(); });
observer.observe(document.documentElement, {childList:true, subtree:true});
queueRefresh(); setTimeout(queueRefresh,250); setTimeout(queueRefresh,600); setTimeout(queueRefresh,1200);
console.log('[世界状态记忆表格] 人物表三段展示已加载（含NPC长期发展锚点）');
