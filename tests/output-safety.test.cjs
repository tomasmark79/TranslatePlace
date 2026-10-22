const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const original = 'Hello `code` https://example.com';
const translated = 'Translated ⟦TP0⟧ ⟦TP1⟧';

function fixture({raw = translated, autoPaste = true, copy = false, afterTranslation, onVerify, beforePaste} = {}) {
    const window = {get_wm_class: () => 'TextEditor'};
    const state = {clipboard: original, selection: original, copies: 0, pastes: 0, clipboardWrites: 0,
        notifications: [], entries: [], display: {focus_window: window}};
    const context = vm.createContext({
        Extension: class {}, global: {display: state.display},
        Main: {notify: (_title, message) => state.notifications.push(message)},
        St: {ClipboardType: {CLIPBOARD: 1}, Clipboard: {get_default: () => ({
            set_text(_type, text) {state.clipboard = text; state.clipboardWrites++;},
        })}},
        getClipboard: () => state.clipboard,
        captureSelection: async () => {
            if (++state.copies > 1)
                onVerify?.(state);
            state.clipboard = state.selection;
            return state.selection;
        },
        capturePaste: () => state.pastes++, beforePaste: () => beforePaste?.(state),
        logError() {},
    });
    const protection = fs.readFileSync(path.join(__dirname, '../protection.js'), 'utf8').replaceAll('export ', '');
    const source = fs.readFileSync(path.join(__dirname, '../extension.js'), 'utf8')
        .replace(/^import .*;\n/gm, '').replace('export default class TranslatePlace', 'class TranslatePlace');
    vm.runInContext(protection + '\n' + source + `
        globalThis.TranslatePlace = TranslatePlace;
        waitForShortcutRelease = async () => {};
        readFreshSelection = captureSelection;
        readClipboard = async () => getClipboard();
        pause = async () => beforePaste();
        controlKey = () => capturePaste();
    `, context);
    const instance = new context.TranslatePlace();
    Object.assign(instance, {
        _cancellable: {is_cancelled: () => false}, _ready: Promise.resolve(),
        _settings: {get_int: () => 50, get_boolean: key => key === 'auto-paste' ? autoPaste : copy},
        _history: {add: async entry => state.entries.push(entry), save: async () => {}},
        _api: {translate: async text => {
            assert.equal(text, 'Hello ⟦TP0⟧ ⟦TP1⟧');
            afterTranslation?.(state);
            return raw;
        }},
        _updateMenu() {},
    });
    return {state, run: () => instance._translate('en')};
}

test('Replacement rechecks the current selection before pasting', async () => {
    const {state, run} = fixture();
    await run();
    assert.equal(state.copies, 2);
    assert.equal(state.pastes, 1);
    assert.equal(state.clipboard, 'Translated `code` https://example.com');
});

for (const selection of ['Another field', '']) {
    test(`Changed selection in the same window prevents replacement: ${JSON.stringify(selection)}`, async () => {
        const {state, run} = fixture({afterTranslation: state => {state.selection = selection;}});
        await assert.rejects(run(), /The selection changed/);
        assert.equal(state.pastes, 0);
        assert.equal(state.clipboardWrites, 0);
        assert.equal(state.entries[0].original, original);
        assert.equal(state.entries[0].translated, 'Translated `code` https://example.com');
    });
}

test('Focus changes during selection verification prevent clipboard output', async () => {
    const {state, run} = fixture({onVerify: state => {state.display.focus_window = {};}});
    await assert.rejects(run(), /The active window changed/);
    assert.equal(state.clipboardWrites, 0);
    assert.equal(state.pastes, 0);
});

test('Clipboard changes while preparing Ctrl+V prevent pasting unrelated data', async () => {
    const {state, run} = fixture({beforePaste: state => {state.clipboard = 'Unrelated copied text';}});
    await assert.rejects(run(), /The clipboard changed/);
    assert.equal(state.pastes, 0);
    assert.equal(state.clipboard, 'Unrelated copied text');
});

test('Copy-only mode does not recapture or require an unchanged selection', async () => {
    const {state, run} = fixture({autoPaste: false, copy: true,
        afterTranslation: state => {state.selection = 'Another field';}});
    await run();
    assert.equal(state.copies, 1);
    assert.equal(state.pastes, 0);
    assert.equal(state.clipboard, 'Translated `code` https://example.com');
});

for (const [raw, warning] of [
    ['Translated ⟦TP0⟧', /Missing/],
    ['Translated ⟦TP0⟧ ⟦TP0⟧ ⟦TP1⟧', /repeated/],
    ['Translated ⟦TP1⟧ ⟦TP0⟧', /order/],
    ['Translated ⟦TP0⟧ ⟦TP1⟧ ⟦TP99⟧', /unknown/],
]) {
    for (const autoPaste of [false, true]) {
        test(`Protected text warning ${warning} prevents automatic output, replacement=${autoPaste}`, async () => {
            const {state, run} = fixture({raw, autoPaste, copy: true});
            await run();
            assert.match(state.entries[0].warning, warning);
            assert.equal(state.entries[0].status, 'Needs review');
            assert.equal(state.clipboardWrites, 0);
            assert.equal(state.pastes, 0);
            assert.equal(state.clipboard, original);
            assert.match(state.notifications[0], /Review the translation in history/);
        });
    }
}
