// Citlivé části se obnovují po překladu; odchylky se hlásí v historii.
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
        warnings.push(`Chybí ${missing.length} chráněných částí: ${missing.map(index => parts[index]).join(', ')}`);
    if (reordered)
        warnings.push('Model změnil pořadí chráněných částí.');
    if (duplicate)
        warnings.push('Model zopakoval chráněnou část.');
    if (unknown || /⟦[^⟧]*TP[^⟧]*⟧/i.test(text))
        warnings.push('Model vrátil neznámou nebo poškozenou značku.');
    return {text, warning: warnings.join(' ')};
}
