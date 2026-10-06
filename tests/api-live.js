import Gio from 'gi://Gio';
import {TranslationApi} from '../api.js';

const api = new TranslationApi();
try {
    const translated = await api.translate('Ahoj světe.', 'cs', 'en', new Gio.Cancellable());
    if (!translated)
        throw new Error('Prázdný výsledek');
    print(translated);
} finally {
    api.close();
}
