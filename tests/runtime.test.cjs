const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function lifecycleFixture(load) {
    const handlers = new Map();
    const saves = [];
    const settings = {get_int: () => 1,
        connect: (key, callback) => {handlers.set(key, callback); return key;}, disconnect() {}};
    const context = vm.createContext({
        Extension: class {getSettings() {return settings;}},
        Gio: {icon_new_for_string: filename => filename, Cancellable: class {
            is_cancelled() {return Boolean(this.cancelled);}
            cancel() {this.cancelled = true;}
        }},
        History: class {
            constructor() {this.entries = [];}
            load() {return load(this);}
            save() {saves.push(this.entries.map(entry => entry.original)); return Promise.resolve();}
        },
        TranslationApi: class {close() {}},
        Clutter: {get_default_backend: () => ({get_default_seat: () => ({create_virtual_device() {}})}), InputDeviceType: {}},
        PanelMenu: {Button: class {add_child() {} destroy() {}}}, St: {Icon: class {}},
        Main: {notify() {}, panel: {addToStatusArea() {}}, wm: {addKeybinding() {}, removeKeybinding() {}}},
        Meta: {KeyBindingFlags: {}}, Shell: {ActionMode: {}}, log() {}, logError() {},
    });
    const source = fs.readFileSync(path.join(__dirname, '../extension.js'), 'utf8')
        .replace(/^import .*;\n/gm, '').replace('export default class TranslatePlace', 'class TranslatePlace');
    vm.runInContext(source + '\nglobalThis.TranslatePlace = TranslatePlace;', context);
    const instance = new context.TranslatePlace();
    instance._buildMenu = () => {
        instance._historyScroll = {remove_child() {}, destroy() {}};
        instance._historySection = {actor: {}, destroy() {}};
    };
    instance._updateMenu = () => {};
    return {instance, handlers, saves};
}

test('Changing the history limit waits for loading and preserves existing entries', async () => {
    let finishLoad;
    const {instance, handlers, saves} = lifecycleFixture(history => new Promise(resolve => {
        finishLoad = () => {
            history.entries = [{original: 'Newest'}, {original: 'Older'}];
            resolve();
        };
    }));
    instance.enable();
    handlers.get('changed::history-limit')();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(saves.length, 0, 'History was overwritten before loading');
    finishLoad();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(Array.from(saves[0]), ['Newest']);
    instance.disable();
});

test('A history limit change cannot overwrite unreadable history or write after disable', async () => {
    const failed = lifecycleFixture(() => Promise.reject(new Error('Unreadable history')));
    failed.instance.enable();
    failed.handlers.get('changed::history-limit')();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(failed.saves.length, 0);
    failed.instance.disable();

    let finishLoad;
    const cancelled = lifecycleFixture(() => new Promise(resolve => {finishLoad = resolve;}));
    cancelled.instance.enable();
    cancelled.handlers.get('changed::history-limit')();
    cancelled.instance.disable();
    finishLoad();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(cancelled.saves.length, 0);
});

test('A successful re-enable recovers from an earlier history load error', async () => {
    let fail = true;
    const {instance, handlers, saves} = lifecycleFixture(history => {
        if (fail)
            return Promise.reject(new Error('Unreadable history'));
        history.entries = [{original: 'Recovered history'}];
        return Promise.resolve();
    });
    instance.enable();
    await instance._ready;
    assert.equal(instance._loadError.message, 'Unreadable history');
    instance.disable();
    fail = false;
    instance.enable();
    await instance._ready;
    assert.equal(instance._loadError, null, 'An old load error still blocks translation');
    handlers.get('changed::history-limit')();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(Array.from(saves[0]), ['Recovered history']);
    instance.disable();
});

for (const cancelDuringSave of [false, true]) {
    test(`Translation errors survive a failed history write; cancellation=${cancelDuringSave}`, async () => {
        const originalError = new Error('API failed');
        const saveError = new Error('History write failed');
        const logged = [];
        let cancelled = false;
        let finishSave;
        let saveStarted;
        const saving = new Promise(resolve => {saveStarted = resolve;});
        const window = {get_wm_class: () => 'TextEditor'};
        const context = vm.createContext({
            Extension: class {}, global: {display: {focus_window: window}},
            protectText: text => ({text, parts: []}),
            logError: error => logged.push(error),
        });
        const source = fs.readFileSync(path.join(__dirname, '../extension.js'), 'utf8')
            .replace(/^import .*;\n/gm, '').replace('export default class TranslatePlace', 'class TranslatePlace');
        vm.runInContext(source + `
            globalThis.TranslatePlace = TranslatePlace;
            waitForShortcutRelease = async () => {};
            readFreshSelection = async () => 'Selected text';
        `, context);
        const instance = new context.TranslatePlace();
        let updates = 0;
        Object.assign(instance, {
            _ready: Promise.resolve(), _cancellable: {is_cancelled: () => cancelled},
            _settings: {get_int: () => 50},
            _history: {add: async () => {}, save: () => {
                saveStarted();
                return new Promise((_resolve, reject) => {finishSave = () => reject(saveError);});
            }},
            _api: {translate: async () => {throw originalError;}},
            _updateMenu: () => {updates++;},
        });
        const pending = instance._translate('en');
        await saving;
        assert.equal(updates, 1);
        if (cancelDuringSave) {
            cancelled = true;
            instance._history = null;
            instance._settings = null;
            instance._updateMenu = () => {throw new Error('Menu was already destroyed');};
        }
        finishSave();
        await assert.rejects(pending, error => error === originalError);
        assert.equal(logged.length, cancelDuringSave ? 0 : 1);
        if (!cancelDuringSave) {
            assert.equal(logged[0], saveError);
            assert.equal(updates, 2);
        }
    });
}

test('Both shortcuts select independent targets, retain the active job target and clean up on disable', async () => {
    const bindings = new Map();
    const removed = [];
    const handlers = new Map();
    const values = {'target-language': 'de', 'secondary-target-language': 'fr', 'history-limit': 50};
    const settings = {get_user_value: () => true, get_string: key => values[key], get_int: key => values[key],
        connect: (key, callback) => {handlers.set(key, callback); return key;}, disconnect() {}};
    const context = vm.createContext({
        Extension: class { getSettings() { return settings; } },
        Gio: {icon_new_for_string: filename => filename, Cancellable: class { is_cancelled() { return false; } cancel() {} }},
        Clutter: {get_default_backend: () => ({get_default_seat: () => ({create_virtual_device() {}})}), InputDeviceType: {}},
        TranslationApi: class { close() {} }, History: class { load() { return Promise.resolve(); } },
        PanelMenu: {Button: class { add_child() {} destroy() {} }}, St: {Icon: class {}},
        Main: {panel: {addToStatusArea() {}}, wm: {
            addKeybinding(key, _settings, _flags, _mode, callback) {bindings.set(key, callback);},
            removeKeybinding(key) { removed.push(key); }
        }}, Meta: {KeyBindingFlags: {NONE: 0}}, Shell: {ActionMode: {NORMAL: 1}}, log() {}, logError() {}
    });
    const languages = fs.readFileSync(path.join(__dirname, '../languages.js'), 'utf8').replaceAll('export ', '');
    const extension = fs.readFileSync(path.join(__dirname, '../extension.js'), 'utf8')
        .replace(/^import .*;\n/gm, '').replace('export default class TranslatePlace', 'class TranslatePlace');
    vm.runInContext(languages + '\n' + extension + '\nglobalThis.TranslatePlace = TranslatePlace;', context);
    const instance = new context.TranslatePlace();
    instance._buildMenu = () => {
        instance._historyScroll = {remove_child() {}, destroy() {}};
        instance._historySection = {actor: {}, destroy() {}};
    };
    instance._updateMenu = () => {};
    instance.enable();
    assert.deepEqual([...bindings.keys()], ['translate-shortcut', 'translate-secondary-shortcut']);
    assert(handlers.has('changed::translate-shortcut'));
    assert(handlers.has('changed::translate-secondary-shortcut'));
    const targets = [];
    let finish;
    instance._translate = target => { targets.push(target); return new Promise(resolve => {finish = resolve;}); };
    bindings.get('translate-shortcut')();
    values['target-language'] = 'es';
    bindings.get('translate-secondary-shortcut')();
    assert.deepEqual(targets, ['de']); // A second shortcut cannot replace a running request.
    finish();
    await new Promise(resolve => setImmediate(resolve));
    bindings.get('translate-secondary-shortcut')();
    assert.deepEqual(targets, ['de', 'fr']);
    finish();
    await new Promise(resolve => setImmediate(resolve));
    instance.disable();
    assert.deepEqual(removed, ['translate-shortcut', 'translate-secondary-shortcut']);
});

for (const autoPaste of [false, true]) {
    for (const copy of [false, true]) {
        test(`Output switches are independent: replacement=${autoPaste}, clipboard=${copy}`, async () => {
            let clipboard = 'Ahoj';
            let pastes = 0;
            let saved;
            const notifications = [];
            const window = {get_wm_class: () => 'TextEditor'};
            const context = vm.createContext({
                Extension: class {}, global: {display: {focus_window: window}},
                Main: {notify: (_title, message) => notifications.push(message)},
                St: {Clipboard: {get_default: () => ({set_text: (_type, text) => {clipboard = text;}})}, ClipboardType: {CLIPBOARD: 1}},
                protectText: text => ({text, parts: []}), restoreText: text => ({text, warning: ''}),
                capturePaste: () => pastes++, getClipboard: () => clipboard,
            });
            const source = fs.readFileSync(path.join(__dirname, '../extension.js'), 'utf8')
                .replace(/^import .*;\n/gm, '').replace('export default class TranslatePlace', 'class TranslatePlace');
            vm.runInContext(source + `
                globalThis.TranslatePlace = TranslatePlace;
                waitForShortcutRelease = async () => {};
                readFreshSelection = async () => 'Ahoj';
                readClipboard = async () => getClipboard();
                pause = async () => {};
                controlKey = () => capturePaste();
            `, context);
            const instance = new context.TranslatePlace();
            Object.assign(instance, {
                _cancellable: {is_cancelled: () => false}, _ready: Promise.resolve(),
                _settings: {get_int: () => 50, get_boolean: key => key === 'auto-paste' ? autoPaste : copy},
                _api: {translate: async (_text, source, target) => {
                    assert.equal(source, 'auto'); assert.equal(target, 'en'); return 'Hello';
                }},
                _history: {add: async entry => {saved = entry;}, save: async () => {}},
                _updateMenu() {},
            });
            await instance._translate('en');
            assert.equal(saved.original, 'Ahoj');
            assert.equal(saved.translated, 'Hello');
            assert.equal(clipboard, autoPaste || copy ? 'Hello' : 'Ahoj');
            assert.equal(pastes, autoPaste ? 1 : 0);
            if (copy && !autoPaste) assert.equal(saved.status, 'Copied to clipboard');
        });
    }
}

test('Delete history is hidden for empty history and requires confirmation', async () => {
    class MenuItem {
        constructor() {this.label = {};}
        setSensitive(value) {this.sensitive = value;}
        connect() {}
    }
    let confirmation;
    const context = vm.createContext({Extension: class {}, PopupMenu: {PopupMenuItem: MenuItem},
        DeleteHistoryDialog: class {
            constructor(count, action) {confirmation = {count, action};}
            connect() {} open() {} destroy() {}
        }, Main: {notify() {}}});
    const source = fs.readFileSync(path.join(__dirname, '../extension.js'), 'utf8')
        .replace(/^import .*;\n/gm, '').replace('export default class TranslatePlace', 'class TranslatePlace');
    vm.runInContext(source + '\nglobalThis.TranslatePlace = TranslatePlace;', context);
    const instance = new context.TranslatePlace();
    let clears = 0;
    Object.assign(instance, {
        _settings: {get_strv: key => key === 'translate-shortcut' ? ['<Super><Shift>e'] : [], get_int: () => 50},
        _shortcutLabel: {},
        _deleteHistoryItem: new MenuItem(), _historySection: {removeAll() {}, addMenuItem() {}},
        _history: {entries: [], clear: async function () {clears++; this.entries = [];}},
        _cancellable: {is_cancelled: () => false}, _ready: Promise.resolve(),
    });
    instance._updateMenu();
    assert.equal(instance._deleteHistoryItem.visible, false);
    assert.equal(instance._shortcutLabel.text, '1: Super+Shift+E   ·   2: Not assigned');
    instance._settings.get_strv = key => key === 'translate-shortcut' ? ['<Super><Shift>e'] : ['<Control><Alt>t'];
    instance._updateMenu();
    assert.equal(instance._shortcutLabel.text, '1: Super+Shift+E   ·   2: Control+Alt+T');
    instance._confirmDeleteHistory();
    assert.equal(confirmation, undefined);
    instance._history.entries = [{original: 'Private text', translated: 'Translation'}];
    instance._updateMenu();
    assert.equal(instance._deleteHistoryItem.visible, true);
    instance._confirmDeleteHistory();
    assert.equal(confirmation.count, 1);
    assert.equal(clears, 0); // Merely opening or cancelling the dialog never deletes anything.
    confirmation.action();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(clears, 1);
    assert.equal(instance._deleteHistoryItem.visible, false);
});

test('Delete confirmation separates Cancel from Delete all and supports Escape', () => {
    const context = vm.createContext({
        GObject: {registerClass: value => value},
        ModalDialog: {ModalDialog: class {
            _init() {this.contentLayout = {add_child() {}};}
            setButtons(buttons) {this.buttons = buttons;}
            close() {this.closed = true;}
        }},
        St: {Label: class { get_clutter_text() {return {set_line_wrap() {}, set_line_wrap_mode() {}};} }},
        Pango: {WrapMode: {WORD_CHAR: 1}}, Clutter: {KEY_Escape: 65307},
    });
    const source = fs.readFileSync(path.join(__dirname, '../historyDialog.js'), 'utf8')
        .replace(/^import .*;\n/gm, '').replaceAll('export ', '');
    vm.runInContext(source + '\nglobalThis.DeleteHistoryDialog = DeleteHistoryDialog;', context);
    let deleted = 0;
    const cancel = new context.DeleteHistoryDialog();
    cancel._init(3, () => deleted++);
    assert.equal(cancel.buttons[0].label, 'Cancel');
    assert.equal(cancel.buttons[0].key, 65307);
    cancel.buttons[0].action();
    assert.equal(deleted, 0);
    assert.equal(cancel.closed, true);
    const confirm = new context.DeleteHistoryDialog();
    confirm._init(3, () => deleted++);
    assert.equal(confirm.buttons[1].label, 'Delete all');
    confirm.buttons[1].action();
    assert.equal(deleted, 1);
    assert.equal(confirm.closed, true);
});
