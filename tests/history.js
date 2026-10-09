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

const oldEntry = history.entries[0];
const queued = history.save(50, cancellable);
await history.clear(50, cancellable);
await queued;
if (history.entries.length)
    throw new Error('Cleared entries are still visible');
oldEntry.translated = 'Late result';
await history.save(50, cancellable);
const cleared = new History();
await cleared.load(cancellable);
if (cleared.entries.length)
    throw new Error('Queued writes or a late translation restored deleted history');
await history.add({original: 'New selection', translated: 'New translation'}, 50, cancellable);
const fresh = new History();
await fresh.load(cancellable);
if (fresh.entries.length !== 1 || fresh.entries[0].original !== 'New selection')
    throw new Error('New history cannot be saved after clearing');
const before = history.entries[0];
const write = history.save.bind(history);
history.save = async () => { throw new Error('Simulated write failure'); };
try {
    await history.clear(50, cancellable);
    throw new Error('Write failure was not reported');
} catch (error) {
    if (error.message !== 'Simulated write failure') throw error;
}
if (history.entries[0] !== before)
    throw new Error('Failed clearing removed history from memory');
history.save = write;
print('History deletion, late results and write failure tests passed.');

const cancelled = new Gio.Cancellable();
cancelled.cancel();
const failedWrite = history.save(50, cancelled);
const nextWrite = history.save(50, new Gio.Cancellable());
let writeError;
try { await failedWrite; } catch (error) { writeError = error; }
if (!writeError?.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
    throw new Error('A failed queued write did not report its error');
await nextWrite;
const recovered = new History();
await recovered.load(new Gio.Cancellable());
if (recovered.entries[0].original !== 'New selection')
    throw new Error('A failed queued write blocked later writes');

for (const contents of ['invalid JSON', '{}', 'null']) {
    await file.replace_contents_async(new TextEncoder().encode(contents), null, false,
        Gio.FileCreateFlags.PRIVATE, null);
    let loadError;
    try { await new History().load(new Gio.Cancellable()); } catch (error) { loadError = error; }
    if (!loadError)
        throw new Error('Invalid history was silently treated as empty');
    const [bytes] = await file.load_contents_async(null);
    if (new TextDecoder().decode(bytes) !== contents)
        throw new Error('Loading invalid history modified the file');
}
await file.replace_contents_async(new TextEncoder().encode(JSON.stringify([null, {original: 'Valid entry'}])),
    null, false, Gio.FileCreateFlags.PRIVATE, null);
const filtered = new History();
await filtered.load(new Gio.Cancellable());
if (filtered.entries.length !== 1 || filtered.entries[0].original !== 'Valid entry')
    throw new Error('A null history item prevented loading valid entries');
print('History queue recovery and invalid file tests passed.');
