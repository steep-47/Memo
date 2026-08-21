function tableEditMatches(text) {
    const matches = [];
    const regex = /<tableEdit\b[^>]*>([\s\S]*?)<\/tableEdit>/gi;
    let match;
    while ((match = regex.exec(String(text ?? ''))) !== null) matches.push(match[1]);
    return matches;
}

function activeReasoning(piece) {
    const swipeId = Number(piece?.swipe_id);
    const swipeReasoning = Number.isInteger(swipeId) && swipeId >= 0
        ? piece?.swipe_info?.[swipeId]?.extra?.reasoning
        : '';
    return String(swipeReasoning || piece?.extra?.reasoning || '');
}

export function getMemoTableEditChannel(piece) {
    const contentMatches = tableEditMatches(piece?.mes);
    if (contentMatches.length) return { matches: contentMatches, source: 'content' };
    const reasoningMatches = tableEditMatches(activeReasoning(piece));
    if (reasoningMatches.length) return { matches: reasoningMatches, source: 'reasoning' };
    return { matches: [], source: 'none' };
}

export { activeReasoning, tableEditMatches };
