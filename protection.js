// Restore protected parts after translation and report discrepancies in history.
const PROTECTED = /```[\s\S]*?```|`[^`\n]*`|!?(?:\[[^\]\n]*\]\([^\)\n]*\))|<[^>\n]+>|https?:\/\/[^\s<>]+|\*\*|__|~~|(?:^|\n)[ \t]*(?:[-*+] |\d+\. |>[ \t]*)|[\u{1F1E6}-\u{1F1FF}]{2}|[0-9#*]\uFE0F?\u20E3|\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?)*/gu;

export function protectText(source) {
    const parts = [];
    const text = source.replace(PROTECTED, match => {
        const token = `⟦TP${parts.length}⟧`;
        parts.push(match);
        return token;
    });
    return {text, parts};
}

export function restoreText(translated, parts) {
    const seen = new Set();
    const ordered = [];
    let unknown = false;
    let duplicate = false;
    const text = translated.replace(/⟦\s*TP\s*(\d+)\s*⟧/gi, (_token, index) => {
        const number = Number(index);
        if (number >= parts.length) {
            unknown = true;
            return '';
        }
        if (seen.has(number)) {
            duplicate = true;
            return '';
        }
        seen.add(number);
        ordered.push(number);
        return parts[number];
    });
    const missing = parts.map((_part, index) => index).filter(index => !seen.has(index));
    const reordered = ordered.some((number, index) => index > 0 && number < ordered[index - 1]);
    const warnings = [];
    if (missing.length)
        warnings.push(`Missing ${missing.length} protected parts: ${missing.map(index => parts[index]).join(', ')}`);
    if (reordered)
        warnings.push('The model changed the order of protected parts.');
    if (duplicate)
        warnings.push('The model repeated a protected part.');
    if (unknown || /⟦[^⟧]*TP[^⟧]*⟧/i.test(text))
        warnings.push('The model returned an unknown or damaged placeholder.');
    return {text, warning: warnings.join(' ')};
}
