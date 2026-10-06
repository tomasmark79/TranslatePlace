import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {TranslationApi} from './api.js';
import {History} from './history.js';
import {protectText, restoreText} from './protection.js';

const SHORTCUT = 'translate-shortcut';
const COPY_WAIT_MS = 1200;

function pause(ms, cancellable) {
    return new Promise((resolve, reject) => {
        if (cancellable.is_cancelled()) {
            reject(new Error('Zrušeno'));
            return;
        }
        let source = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            cancellable.disconnect(signal);
            source = 0;
            resolve();
            return GLib.SOURCE_REMOVE;
        });
        const signal = cancellable.connect(() => {
            if (source) {
                GLib.Source.remove(source);
                source = 0;
                reject(new Error('Zrušeno'));
            }
        });
    });
}

function sendKey(device, code, state) {
    device.notify_key(GLib.get_monotonic_time(), code, state);
}

function controlKey(device, code) {
    sendKey(device, 29, Clutter.KeyState.PRESSED);
    sendKey(device, code, Clutter.KeyState.PRESSED);
    sendKey(device, code, Clutter.KeyState.RELEASED);
    sendKey(device, 29, Clutter.KeyState.RELEASED);
}

function readClipboard(cancellable) {
    return new Promise((resolve, reject) => {
        St.Clipboard.get_default().get_text(St.ClipboardType.CLIPBOARD, (_clipboard, text) => {
            if (cancellable.is_cancelled())
                reject(new Error('Zrušeno'));
            else
                resolve(text ?? '');
        });
    });
}

function readFreshSelection(device, cancellable) {
    return new Promise((resolve, reject) => {
        const selection = global.display.get_selection();
        let done = false;
        let timeout = 0;
        const finish = (error, text) => {
            if (done)
                return;
            done = true;
            selection.disconnect(handler);
            cancellable.disconnect(cancelHandler);
            if (timeout)
                GLib.Source.remove(timeout);
            if (error)
                reject(error);
            else
                resolve(text);
        };
        const handler = selection.connect('owner-changed', (_selection, type) => {
            if (type !== Meta.SelectionType.SELECTION_CLIPBOARD)
                return;
            readClipboard(cancellable).then(text => {
                if (!text)
                    finish(new Error('Označený text je prázdný.'));
                else
                    finish(null, text);
            }).catch(error => finish(error));
        });
        const cancelHandler = cancellable.connect(() => finish(new Error('Zrušeno')));
        timeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, COPY_WAIT_MS, () => {
            timeout = 0;
            finish(new Error('Nepodařilo se přečíst označený text.'));
            return GLib.SOURCE_REMOVE;
        });
        controlKey(device, 46); // Ctrl+C
    });
}

function shortText(text) {
    const line = text.replace(/\s+/g, ' ').trim();
    return line.length > 88 ? `${line.slice(0, 85)}…` : line;
}

export default class TranslatePlace extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._cancellable = new Gio.Cancellable();
        this._api = new TranslationApi();
        this._history = new History();
        this._busy = false;
        this._device = Clutter.get_default_backend().get_default_seat().create_virtual_device(
            Clutter.InputDeviceType.KEYBOARD_DEVICE);
        this._indicator = new PanelMenu.Button(0.0, 'TranslatePlace');
        this._indicator.add_child(new St.Icon({icon_name: 'preferences-desktop-locale-symbolic', style_class: 'system-status-icon'}));
        Main.panel.addToStatusArea(this.uuid, this._indicator);
        const cancellable = this._cancellable;
        this._ready = this._history.load(cancellable).then(() => {
            if (!cancellable.is_cancelled())
                this._updateMenu();
        }).catch(error => {
            if (!cancellable.is_cancelled()) {
                this._loadError = error;
                Main.notify('TranslatePlace', 'Nepodařilo se načíst historii překladů.');
                logError(error, '[TranslatePlace] historie');
            }
        });
        this._limitHandler = this._settings.connect('changed::history-limit', () => {
            this._history.entries.length = Math.min(this._history.entries.length, this._settings.get_int('history-limit'));
            this._history.save(this._settings.get_int('history-limit'), this._cancellable)
                .catch(error => {
                    if (!cancellable.is_cancelled())
                        logError(error, '[TranslatePlace] ukládání historie');
                });
            this._updateMenu();
        });
        Main.wm.addKeybinding(SHORTCUT, this._settings, Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL, () => this._startTranslation());
        this._updateMenu();
    }

    disable() {
        Main.wm.removeKeybinding(SHORTCUT);
        this._settings.disconnect(this._limitHandler);
        this._cancellable.cancel();
        this._api.close();
        this._historySection?.destroy();
        this._historyScroll?.destroy();
        this._indicator.destroy();
        this._indicator = null;
        this._device = null;
        this._history = null;
        this._settings = null;
        this._api = null;
        this._cancellable = null;
    }

    _updateMenu() {
        const menu = this._indicator.menu;
        this._historySection?.destroy();
        this._historyScroll?.destroy();
        menu.removeAll();
        const title = new PopupMenu.PopupMenuItem('TranslatePlace · Super+Shift+E');
        title.setSensitive(false);
        menu.addMenuItem(title);
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const list = new PopupMenu.PopupMenuSection();
        const scroll = new St.ScrollView({style: 'max-height: 380px;',
            hscrollbar_policy: St.PolicyType.NEVER, vscrollbar_policy: St.PolicyType.AUTOMATIC,
            child: list.actor});
        this._historyScroll = scroll;
        this._historySection = list;
        list._setParent(menu);
        menu.box.add_child(scroll);
        if (!this._history.entries.length) {
            const empty = new PopupMenu.PopupMenuItem('Zatím žádné překlady');
            empty.setSensitive(false);
            list.addMenuItem(empty);
        }
        for (const entry of this._history.entries) {
            const item = new PopupMenu.PopupSubMenuMenuItem(
                `${entry.warning ? '⚠ ' : ''}${shortText(entry.original)}`);
            const original = new PopupMenu.PopupMenuItem(`Původní: ${entry.original}`);
            original.setSensitive(false);
            original.label.get_clutter_text().set_line_wrap(true);
            item.menu.addMenuItem(original);
            const result = new PopupMenu.PopupMenuItem(
                entry.translated ? `Překlad: ${entry.translated}` : `Stav: ${entry.status}`);
            result.setSensitive(false);
            result.label.get_clutter_text().set_line_wrap(true);
            item.menu.addMenuItem(result);
            if (entry.warning) {
                const warning = new PopupMenu.PopupMenuItem(`Upozornění: ${entry.warning}`);
                warning.setSensitive(false);
                warning.label.get_clutter_text().set_line_wrap(true);
                item.menu.addMenuItem(warning);
            }
            if (entry.translated) {
                const copy = new PopupMenu.PopupMenuItem('Zkopírovat překlad');
                copy.connect('activate', () => St.Clipboard.get_default().set_text(
                    St.ClipboardType.CLIPBOARD, entry.translated));
                item.menu.addMenuItem(copy);
            }
            list.addMenuItem(item);
        }
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const prefs = new PopupMenu.PopupImageMenuItem('Nastavení', 'emblem-system-symbolic');
        prefs.connect('activate', () => this.openPreferences());
        menu.addMenuItem(prefs);
    }

    _startTranslation() {
        if (this._busy)
            return;
        this._busy = true;
        const cancellable = this._cancellable;
        this._translate().catch(error => {
            if (!cancellable.is_cancelled()) {
                Main.notify('TranslatePlace', error.message);
                logError(error, '[TranslatePlace] překlad');
            }
        }).finally(() => {
            if (!cancellable.is_cancelled())
                this._busy = false;
        });
    }

    async _translate() {
        const cancellable = this._cancellable;
        await this._ready;
        if (cancellable.is_cancelled())
            return;
        if (this._loadError)
            throw new Error('Historie je nedostupná; překlad je vypnutý, aby se neztratil originál.');
        await pause(250, cancellable); // Nejprve se musí uvolnit Super+Shift+E.
        const window = global.display.focus_window;
        if (!window)
            throw new Error('Nejprve označte text v okně aplikace.');
        if (/(terminal|console|kitty|alacritty|wezterm|foot|ghostty)/i.test(window.get_wm_class() ?? ''))
            throw new Error('V terminálu by Ctrl+C mohlo přerušit běžící příkaz.');
        const original = await readFreshSelection(this._device, cancellable);
        if (cancellable.is_cancelled())
            return;
        if (original.length > 10000)
            throw new Error('Text přesahuje limit API 10 000 znaků.');
        const direction = this._settings.get_string('direction').split('-');
        const entry = {at: new Date().toISOString(), original, translated: '',
            direction: direction.join('→'), status: 'Překládá se'};
        await this._history.add(entry, this._settings.get_int('history-limit'), cancellable);
        if (cancellable.is_cancelled())
            return;
        this._updateMenu();
        try {
            const masked = protectText(original);
            const raw = await this._api.translate(masked.text, direction[0], direction[1], cancellable);
            if (cancellable.is_cancelled())
                return;
            const restored = restoreText(raw, masked.parts);
            entry.translated = restored.text;
            entry.warning = restored.warning;
            entry.status = 'Hotovo';
            await this._history.save(this._settings.get_int('history-limit'), cancellable);
            if (cancellable.is_cancelled())
                return;
            this._updateMenu();
            if (!this._settings.get_boolean('auto-paste')) {
                Main.notify('TranslatePlace', 'Překlad je uložen v historii.');
                return;
            }
            if (global.display.focus_window !== window)
                throw new Error('Aktivní okno se změnilo. Překlad je uložen v historii.');
            if (await readClipboard(cancellable) !== original)
                throw new Error('Schránka se změnila. Překlad je uložen v historii.');
            St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, entry.translated);
            await pause(90, cancellable);
            if (global.display.focus_window !== window)
                throw new Error('Aktivní okno se změnilo. Překlad je uložen v historii.');
            controlKey(this._device, 47); // Ctrl+V; aplikace stále drží původní výběr.
            entry.status = 'Vloženo';
            await this._history.save(this._settings.get_int('history-limit'), cancellable);
            if (!cancellable.is_cancelled())
                this._updateMenu();
        } catch (error) {
            if (cancellable.is_cancelled())
                return;
            entry.status = `Chyba: ${error.message}`;
            await this._history.save(this._settings.get_int('history-limit'), cancellable);
            this._updateMenu();
            throw error;
        }
    }
}
