// #4 人物表仅在展示层拆成两张短表；底层人物表结构和数据保持不变。
// 第一张显示当前值字段，第二张显示长期信息字段；界面不额外显示分组标签。
// 兼容旧聊天的 8 列人物表：缺少“别名/称呼”时，第二张表临时补一个空列，
// 同时运行时源结构仍会迁移到新的 9 列定义。

let refreshQueued = false;

function normalizeHeader(text) {
    return String(text || '').replace(/\s+/g, '').trim();
}

function cleanEmptyCell(cell) {
    if (!cell) return;
    const text = String(cell.textContent || '').trim();
    if (/^(无|暂无|没有|未知|未记录|未提及|无数据|N\/A|NA|null|undefined|-|—|--|空)$/i.test(text)) {
        cell.textContent = '';
    }
}

function getPersonSource(container) {
    const headings = Array.from(container.querySelectorAll('h1,h2,h3,h4,h5,h6'));
    const heading = headings.find(el => {
        const text = normalizeHeader(el.textContent);
        return /#?4人物表/.test(text) || text === '人物表';
    });
    if (!heading) return null;

    let node = heading.nextElementSibling;
    while (node) {
        if (/^H[1-6]$/.test(node.tagName)) break;
        if (node.tagName === 'TABLE') return node;
        const nested = node.querySelector?.('table');
        if (nested) return nested;
        node = node.nextElementSibling;
    }
    return null;
}

function sourceSignature(source) {
    return Array.from(source.rows || [])
        .map(row => Array.from(row.cells || []).map(cell => cell.textContent || '').join('\u001f'))
        .join('\u001e');
}

function appendVirtualCell(rowClone, isHeaderRow, text = '', templateCell = null) {
    const cell = templateCell
        ? templateCell.cloneNode(true)
        : document.createElement(isHeaderRow ? 'th' : 'td');

    cell.removeAttribute('id');
    cell.textContent = isHeaderRow ? text : '';
    rowClone.appendChild(cell);
}

function cloneColumns(source, descriptors, indexColumn = -1, headerRow = null) {
    const wrapper = document.createElement('div');
    wrapper.className = 'memory-person-half';

    const table = source.cloneNode(false);
    table.removeAttribute('id');
    table.classList.remove('memory-person-source');
    table.classList.add('memory-person-half-table');

    for (const section of Array.from(source.children)) {
        if (!['THEAD', 'TBODY', 'TFOOT'].includes(section.tagName)) continue;
        const sectionClone = section.cloneNode(false);

        for (const row of Array.from(section.rows || [])) {
            const rowClone = row.cloneNode(false);
            const cells = Array.from(row.cells || []);
            const isHeaderRow = row === headerRow;
            const templateCell = cells.find((cell, index) => index !== indexColumn && !!cell) || null;

            if (indexColumn >= 0 && cells[indexColumn]) {
                rowClone.appendChild(cells[indexColumn].cloneNode(true));
            }

            for (const descriptor of descriptors) {
                if (descriptor.virtual) {
                    appendVirtualCell(rowClone, isHeaderRow, descriptor.name, templateCell);
                    continue;
                }

                const index = descriptor.index;
                if (index === indexColumn || index < 0 || !cells[index]) continue;
                const cell = cells[index].cloneNode(true);
                if (!isHeaderRow) cleanEmptyCell(cell);
                rowClone.appendChild(cell);
            }

            sectionClone.appendChild(rowClone);
        }

        if (sectionClone.children.length) table.appendChild(sectionClone);
    }

    wrapper.appendChild(table);
    return wrapper;
}

function splitPersonTable() {
    const container = document.querySelector('#tableContainer');
    if (!container) return;

    const source = getPersonSource(container);
    if (!source) return;

    const headerRow = source.querySelector('thead tr') || source.querySelector('tr');
    if (!headerRow) return;

    const headers = Array.from(headerRow.cells).map(cell => normalizeHeader(cell.textContent));
    const indexColumn = headers[0] === '' ? 0 : -1;
    const indexOf = name => headers.findIndex(h => h === name);

    const coreRequired = ['姓名','身份/所属','修为','外貌特征','性格','与玩家关系','当前状态','重要信息'];
    const positions = Object.fromEntries(coreRequired.map(name => [name, indexOf(name)]));

    if (coreRequired.some(name => positions[name] < 0)) {
        source.classList.remove('memory-person-source');
        container.querySelectorAll('.memory-person-two-tables').forEach(el => el.remove());
        return;
    }

    const aliasIndex = indexOf('别名/称呼');

    const firstGroup = ['姓名','身份/所属','修为','与玩家关系','当前状态']
        .map(name => ({ name, index: positions[name], virtual: false }));

    const secondGroup = [
        { name: '姓名', index: positions['姓名'], virtual: false },
        aliasIndex >= 0
            ? { name: '别名/称呼', index: aliasIndex, virtual: false }
            : { name: '别名/称呼', index: -1, virtual: true },
        { name: '外貌特征', index: positions['外貌特征'], virtual: false },
        { name: '性格', index: positions['性格'], virtual: false },
        { name: '重要信息', index: positions['重要信息'], virtual: false },
    ];

    source.classList.add('memory-person-source');

    const signature = `${sourceSignature(source)}|alias:${aliasIndex >= 0 ? 'real' : 'virtual'}`;
    let view = container.querySelector('.memory-person-two-tables');
    if (view?.dataset?.sourceSignature === signature) return;

    const nextView = document.createElement('div');
    nextView.className = 'memory-person-two-tables';
    nextView.dataset.sourceSignature = signature;
    nextView.appendChild(cloneColumns(source, firstGroup, indexColumn, headerRow));
    nextView.appendChild(cloneColumns(source, secondGroup, indexColumn, headerRow));

    if (view) {
        view.replaceWith(nextView);
    } else {
        const host = source.parentElement;
        if (host && host !== container && host.children.length === 1) host.after(nextView);
        else source.after(nextView);
    }

    container.querySelectorAll('.memory-person-two-tables').forEach(el => {
        if (el !== nextView) el.remove();
    });
}

function queueRefresh() {
    if (refreshQueued) return;
    refreshQueued = true;
    requestAnimationFrame(() => {
        refreshQueued = false;
        splitPersonTable();
    });
}

function mutationIsOnlyPersonView(mutation) {
    const nodes = [...mutation.addedNodes, ...mutation.removedNodes];
    return nodes.length > 0 && nodes.every(node =>
        node.nodeType === 1 && node.matches?.('.memory-person-two-tables')
    );
}

const observer = new MutationObserver(mutations => {
    if (mutations.every(mutationIsOnlyPersonView)) return;
    queueRefresh();
});
observer.observe(document.documentElement, { childList: true, subtree: true });

queueRefresh();
setTimeout(queueRefresh, 250);
setTimeout(queueRefresh, 600);
setTimeout(queueRefresh, 1200);

console.log('[世界状态记忆表格] 人物表双行展示已加载（兼容旧 8 列与新 9 列）');
