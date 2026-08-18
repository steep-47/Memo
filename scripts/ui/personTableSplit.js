// #4 人物表仅在展示层拆成 A/B 两张短表；底层人物表结构和数据保持不变。
// A = 当前值覆盖更新；B = 长期信息合并更新。

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

function cloneColumns(source, indices, indexColumn = -1, label = '') {
    const wrapper = document.createElement('div');
    wrapper.className = 'memory-person-half';
    wrapper.dataset.group = label;

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

    const required = ['姓名','别名/称呼','身份/所属','修为','外貌特征','性格','与玩家关系','当前状态','重要信息'];
    const positions = Object.fromEntries(required.map(name => [name, indexOf(name)]));

    if (required.some(name => positions[name] < 0)) {
        source.classList.remove('memory-person-source');
        container.querySelectorAll('.memory-person-two-tables').forEach(el => el.remove());
        return;
    }

    // A：当前值覆盖。姓名作为主键/正式称呼也随身份确认覆盖更新。
    const groupA = ['姓名','身份/所属','修为','与玩家关系','当前状态'].map(name => positions[name]);
    // B：长期信息合并；重复姓名用于多人时快速对应。
    const groupB = ['姓名','别名/称呼','外貌特征','性格','重要信息'].map(name => positions[name]);

    source.classList.add('memory-person-source');

    const signature = sourceSignature(source);
    let view = container.querySelector('.memory-person-two-tables');
    if (view?.dataset?.sourceSignature === signature) return;

    const nextView = document.createElement('div');
    nextView.className = 'memory-person-two-tables';
    nextView.dataset.sourceSignature = signature;
    nextView.appendChild(cloneColumns(source, groupA, indexColumn, 'A'));
    nextView.appendChild(cloneColumns(source, groupB, indexColumn, 'B'));

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

console.log('[世界状态记忆表格] 人物表 A/B 展示已加载');
