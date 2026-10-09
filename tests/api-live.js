import Gio from 'gi://Gio';
import {TranslationApi} from '../api.js';

const api = new TranslationApi();
try {
    for (const [text, target] of [['Ahoj světe.', 'en'], ['Hello world.', 'cs']]) {
        const translated = await api.translate(text, 'auto', target, new Gio.Cancellable());
        if (!translated.trim())
            throw new Error('Empty translation');
        print(`${target}: ${translated}`);
    }
} finally {
    api.close();
}
