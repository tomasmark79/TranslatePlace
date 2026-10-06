import {protectText, restoreText} from '../protection.js';

const source = 'Ahoj **světe** https://example.org/a?q=1 😀 [odkaz](https://example.org) `x=1`';
const masked = protectText(source);
if (masked.text.includes('https://') || masked.text.includes('😀') || masked.text.includes('**'))
    throw new Error('Citlivé části nebyly maskovány');
if (restoreText(masked.text, masked.parts).text !== source)
    throw new Error('Obnovení změnilo originál');
const incomplete = restoreText(masked.text.replace('⟦TP0⟧', ''), masked.parts);
if (!incomplete.warning || !incomplete.text)
    throw new Error('Chybějící značka musí zanechat text i varování');
print('Ochrana textu: OK');
