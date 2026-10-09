const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

test('Selection capture cancels without deadlocking GIO and releases its signal', () => {
    const source = fs.readFileSync(path.join(__dirname, '../extension.js'), 'utf8');
    const capture = source.slice(source.search(/(?:async )?function readFreshSelection\(/),
        source.indexOf('\nfunction shortText('));
    const pause = source.slice(source.indexOf('function pause('), source.indexOf('\nfunction sendKey('));
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'translateplace-selection-'));
    try {
        const script = path.join(directory, 'selection.js');
        fs.writeFileSync(script, `
            import Gio from 'gi://Gio';
            import GLib from 'gi://GLib';
            const assert = (condition, message) => { if (!condition) throw new Error(message); };
            let onOwnerChanged = null;
            let copies = 0;
            const selection = {
                connect(_signal, callback) { onOwnerChanged = callback; return 1; },
                disconnect() { onOwnerChanged = null; },
            };
            const global = {display: {get_selection: () => selection}};
            const Meta = {SelectionType: {SELECTION_CLIPBOARD: 1}};
            const COPY_WAIT_MS = 150;
            const controlKey = () => copies++;
            const readClipboard = async () => 'Selected text';
            ${pause}
            ${capture}
            for (const duringRetry of [false, true]) {
                const cancellable = new Gio.Cancellable();
                const pending = readFreshSelection(null, cancellable);
                if (duringRetry) onOwnerChanged(selection, 1);
                cancellable.cancel();
                let error;
                try { await pending; } catch (caught) { error = caught; }
                assert(error?.message === 'Cancelled', 'Cancellation was not reported');
                assert(onOwnerChanged === null, 'Selection signal survived cancellation');
            }
            const cancelled = new Gio.Cancellable();
            cancelled.cancel();
            const before = copies;
            try { await readFreshSelection(null, cancelled); } catch {}
            assert(copies === before, 'Already cancelled capture sent Ctrl+C');
            const success = readFreshSelection(null, new Gio.Cancellable());
            onOwnerChanged(selection, 1);
            assert(await success === 'Selected text', 'Selection capture failed');
            assert(onOwnerChanged === null, 'Selection signal survived success');
            let error;
            try { await readFreshSelection(null, new Gio.Cancellable()); } catch (caught) { error = caught; }
            assert(error?.message === 'Could not read the selected text.', 'Timeout was not reported');
            assert(onOwnerChanged === null, 'Selection signal survived timeout');
            print('Selection cancellation, success and timeout passed.');
        `);
        const result = spawnSync('gjs', ['-m', script], {encoding: 'utf8', timeout: 5000});
        assert.ifError(result.error);
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /Selection cancellation, success and timeout passed/);
    } finally {
        fs.rmSync(directory, {recursive: true, force: true});
    }
});
