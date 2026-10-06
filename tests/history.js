import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {History} from '../history.js';

const cancellable = new Gio.Cancellable();
const history = new History();
await history.load(cancellable);
await history.add({original: 'Dlouhý původní text', translated: '', status: 'Překládá se'}, 50, cancellable);
const again = new History();
await again.load(cancellable);
if (again.entries[0].original !== 'Dlouhý původní text')
    throw new Error('Originál se neuložil');
const file = Gio.File.new_for_path(GLib.build_filenamev([GLib.get_user_state_dir(), 'translateplace', 'history.json']));
const mode = file.query_info('unix::mode', Gio.FileQueryInfoFlags.NONE, null).get_attribute_uint32('unix::mode') & 0o777;
if (mode !== 0o600)
    throw new Error(`Nesprávná oprávnění historie: ${mode.toString(8)}`);
print('Historie: OK');
