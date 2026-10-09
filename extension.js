// Copyright (C) 2026 Tomáš Mark
// SPDX-License-Identifier: GPL-3.0-or-later

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {TranslationApi} from './api.js';
import {History} from './history.js';
import {targetLanguage} from './languages.js';
import {HistoryDialog, DeleteHistoryDialog} from './historyDialog.js';
import {protectText, restoreText} from './protection.js';

const SHORTCUT = 'translate-shortcut';
const SECONDARY_SHORTCUT = 'translate-secondary-shortcut';
const COPY_WAIT_MS = 2500;

function pause(ms, cancellable) {
    return new Promise((resolve, reject) => {
        if (cancellable.is_cancelled()) {
            reject(new Error('Cancelled'));
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
                reject(new Error('Cancelled'));
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
                reject(new Error('Cancelled'));
            else
                resolve(text ?? '');
        });
    });
}

async function readFreshSelection(device, cancellable) {
    if (cancellable.is_cancelled())
        throw new Error('Cancelled');
    let cancelHandler = 0;
    try {
        return await new Promise((resolve, reject) => {
            const selection = global.display.get_selection();
            let done = false;
            let timeout = 0;
            const finish = (error, text) => {
                if (done)
                    return;
                done = true;
                selection.disconnect(handler);
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
                (async () => {
                    for (let attempt = 0; attempt < 12 && !done; attempt++) {
                        await pause(75, cancellable);
                        const text = await readClipboard(cancellable);
                        if (text) {
                            finish(null, text);
                            return;
                        }
                    }
                })().catch(error => finish(error));
            });
            cancelHandler = cancellable.connect(() => finish(new Error('Cancelled')));
            timeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, COPY_WAIT_MS, () => {
                timeout = 0;
                finish(new Error('Could not read the selected text.'));
                return GLib.SOURCE_REMOVE;
            });
            controlKey(device, 46); // Ctrl+C
        });
    } finally {
        if (cancelHandler)
            cancellable.disconnect(cancelHandler);
    }
}

function shortText(text) {
    const line = text.replace(/\s+/g, ' ').trim();
    return line.length > 56 ? `${line.slice(0, 53)}…` : line;
}

async function waitForShortcutRelease(cancellable) {
    const modifiers = Clutter.ModifierType.SHIFT_MASK |
        Clutter.ModifierType.SUPER_MASK | Clutter.ModifierType.MOD4_MASK |
        Clutter.ModifierType.CONTROL_MASK | Clutter.ModifierType.MOD1_MASK;
    for (let attempt = 0; attempt < 60; attempt++) {
        if (!(global.get_pointer()[2] & modifiers)) {
            await pause(80, cancellable);
            return;
        }
        await pause(50, cancellable);
    }
    throw new Error('Release the shortcut keys and try again.');
}

export default class TranslatePlace extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._cancellable = new Gio.Cancellable();
        this._api = new TranslationApi(this._settings);
        this._history = new History();
        this._loadError = null;
        this._busy = false;
        this._clearingHistory = false;
        log('[TranslatePlace] bounded history dialog loaded');
        this._device = Clutter.get_default_backend().get_default_seat().create_virtual_device(
            Clutter.InputDeviceType.KEYBOARD_DEVICE);
        this._indicator = new PanelMenu.Button(0.0, 'TranslatePlace');
        this._indicator.add_child(new St.Icon({icon_name: 'preferences-desktop-locale-symbolic', style_class: 'system-status-icon'}));
        this._buildMenu();
        Main.panel.addToStatusArea(this.uuid, this._indicator);
        const cancellable = this._cancellable;
        this._ready = this._history.load(cancellable).then(() => {
            if (!cancellable.is_cancelled())
                this._updateMenu();
        }).catch(error => {
            if (!cancellable.is_cancelled()) {
                this._loadError = error;
                Main.notify('TranslatePlace', 'Could not load translation history.');
                logError(error, '[TranslatePlace] history');
            }
        });
        this._limitHandler = this._settings.connect('changed::history-limit', () => {
            this._ready.then(async () => {
                if (cancellable.is_cancelled() || this._loadError)
                    return;
                const limit = this._settings.get_int('history-limit');
                this._history.entries.length = Math.min(this._history.entries.length, limit);
                const saved = this._history.save(limit, cancellable);
                this._updateMenu();
                await saved;
            }).catch(error => {
                if (!cancellable.is_cancelled())
                    logError(error, '[TranslatePlace] saving history');
            });
        });
        Main.wm.addKeybinding(SHORTCUT, this._settings, Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL, () => this._startTranslation());
        Main.wm.addKeybinding(SECONDARY_SHORTCUT, this._settings, Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL, () => this._startTranslation(true));
        this._shortcutHandlers = [SHORTCUT, SECONDARY_SHORTCUT].map(key =>
            this._settings.connect(`changed::${key}`, () => this._updateMenu()));
        this._updateMenu();
    }

    disable() {
        Main.wm.removeKeybinding(SHORTCUT);
        Main.wm.removeKeybinding(SECONDARY_SHORTCUT);
        this._settings.disconnect(this._limitHandler);
        for (const handler of this._shortcutHandlers)
            this._settings.disconnect(handler);
        this._cancellable.cancel();
        if (this._dialogSource) {
            GLib.Source.remove(this._dialogSource);
            this._dialogSource = 0;
        }
        this._api.close();
        this._detailDialog?.destroy();
        this._detailDialog = null;
        this._historyScroll.remove_child(this._historySection.actor);
        this._historySection.destroy();
        this._historyScroll.destroy();
        this._indicator.destroy();
        this._historySection = null;
        this._historyScroll = null;
        this._indicator = null;
        this._deleteHistoryItem = null;
        this._device = null;
        this._history = null;
        this._settings = null;
        this._api = null;
        this._cancellable = null;
    }

    _buildMenu() {
        const menu = this._indicator.menu;
        const width = Math.max(320, Math.min(500, global.stage.width - 40));
        this._menuWidth = width;
        menu.actor.style = `width: ${width}px;`;
        const header = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        const heading = new St.BoxLayout({vertical: true, x_expand: true, style: 'spacing: 4px;'});
        heading.add_child(new St.Label({text: 'TranslatePlace', style: 'font-weight: 600;'}));
        this._shortcutLabel = new St.Label({opacity: 180,
            style: `font-size: 0.85em; width: ${width - 60}px;`});
        this._shortcutLabel.get_clutter_text().set_line_wrap(true);
        this._shortcutLabel.get_clutter_text().set_ellipsize(Pango.EllipsizeMode.NONE);
        heading.add_child(this._shortcutLabel);
        header.add_child(heading);
        menu.addMenuItem(header);
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const list = new PopupMenu.PopupMenuSection();
        const scroll = new St.ScrollView({style: `width: ${width}px; max-height: 380px;`,
            hscrollbar_policy: St.PolicyType.NEVER, vscrollbar_policy: St.PolicyType.AUTOMATIC,
            child: list.actor});
        this._historyScroll = scroll;
        this._historySection = list;
        list._setParent(menu);
        menu.box.add_child(scroll);
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._deleteHistoryItem = new PopupMenu.PopupImageMenuItem('Delete history', 'edit-delete-symbolic');
        this._deleteHistoryItem.visible = false;
        this._deleteHistoryItem.connect('activate', () => {
            if (this._dialogSource)
                GLib.Source.remove(this._dialogSource);
            const cancellable = this._cancellable;
            this._dialogSource = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                this._dialogSource = 0;
                if (!cancellable.is_cancelled())
                    this._confirmDeleteHistory();
                return GLib.SOURCE_REMOVE;
            });
        });
        menu.addMenuItem(this._deleteHistoryItem);
        const prefs = new PopupMenu.PopupImageMenuItem('Preferences', 'emblem-system-symbolic');
        prefs.connect('activate', () => this.openPreferences());
        menu.addMenuItem(prefs);
    }

    _updateMenu() {
        this._deleteHistoryItem.visible = this._history.entries.length > 0;
        this._deleteHistoryItem.setSensitive(!this._clearingHistory);
        this._shortcutLabel.text = [SHORTCUT, SECONDARY_SHORTCUT].map((key, index) => {
            const accelerator = this._settings.get_strv(key)[0] || '';
            const shortcut = accelerator.replace(/<([^>]+)>/g, '$1+').replace(/.$/, letter => letter.toUpperCase());
            return `${index + 1}: ${shortcut || 'Not assigned'}`;
        }).join('   ·   ');
        const list = this._historySection;
        const width = this._menuWidth;
        list.removeAll();
        if (!this._history.entries.length) {
            const empty = new PopupMenu.PopupMenuItem('No translations yet');
            empty.setSensitive(false);
            list.addMenuItem(empty);
        }
        for (const entry of this._history.entries) {
            const item = new PopupMenu.PopupMenuItem(
                `${entry.warning ? '⚠ ' : ''}${shortText(entry.original)}`);
            item.label.style = `max-width: ${width - 60}px;`;
            item.connect('activate', () => {
                if (this._dialogSource)
                    GLib.Source.remove(this._dialogSource);
                const cancellable = this._cancellable;
                this._dialogSource = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                    this._dialogSource = 0;
                    if (!cancellable.is_cancelled())
                        this._showHistory(entry);
                    return GLib.SOURCE_REMOVE;
                });
            });
            list.addMenuItem(item);
        }
    }

    _confirmDeleteHistory() {
        if (!this._history.entries.length || this._clearingHistory)
            return;
        this._detailDialog?.destroy();
        const cancellable = this._cancellable;
        const dialog = new DeleteHistoryDialog(this._history.entries.length, () => {
            if (!cancellable.is_cancelled())
                void this._clearHistory().catch(error => {
                    if (!cancellable.is_cancelled())
                        Main.notify('TranslatePlace', `Could not delete history: ${error.message}`);
                });
        });
        this._detailDialog = dialog;
        dialog.connect('destroy', () => {
            if (this._detailDialog === dialog)
                this._detailDialog = null;
        });
        dialog.open();
    }

    async _clearHistory() {
        if (this._clearingHistory)
            return;
        const cancellable = this._cancellable;
        this._clearingHistory = true;
        try {
            await this._ready;
            if (cancellable.is_cancelled())
                return;
            this._detailDialog?.destroy();
            const saved = this._history.clear(this._settings.get_int('history-limit'), cancellable);
            this._updateMenu();
            await saved;
        } finally {
            if (!cancellable.is_cancelled()) {
                this._clearingHistory = false;
                this._updateMenu();
            }
        }
    }

    _showHistory(entry) {
        this._detailDialog?.destroy();
        const dialog = new HistoryDialog(entry);
        this._detailDialog = dialog;
        dialog.connect('destroy', () => {
            if (this._detailDialog === dialog)
                this._detailDialog = null;
        });
        dialog.open();
    }

    _startTranslation(secondary = false) {
        if (this._busy)
            return;
        this._busy = true;
        const cancellable = this._cancellable;
        const target = targetLanguage(this._settings, secondary);
        this._translate(target).catch(error => {
            if (!cancellable.is_cancelled()) {
                Main.notify('TranslatePlace', error.message);
                logError(error, '[TranslatePlace] translation');
            }
        }).finally(() => {
            if (!cancellable.is_cancelled())
                this._busy = false;
        });
    }

    async _translate(target) {
        const cancellable = this._cancellable;
        await this._ready;
        if (cancellable.is_cancelled())
            return;
        if (this._loadError)
            throw new Error('History is unavailable. Translation is disabled to preserve the original text.');
        await waitForShortcutRelease(cancellable);
        const window = global.display.focus_window;
        if (!window)
            throw new Error('Select text in an application window first.');
        if (/(terminal|console|kitty|alacritty|wezterm|foot|ghostty)/i.test(window.get_wm_class() ?? ''))
            throw new Error('Ctrl+C could interrupt a running command in a terminal.');
        const original = await readFreshSelection(this._device, cancellable);
        if (cancellable.is_cancelled())
            return;
        if (original.length > 10000)
            throw new Error('The text exceeds the 10,000-character API limit.');
        const entry = {at: new Date().toISOString(), original, translated: '',
            direction: `auto→${target}`, targetLanguage: target, status: 'Translating'};
        await this._history.add(entry, this._settings.get_int('history-limit'), cancellable);
        if (cancellable.is_cancelled())
            return;
        this._updateMenu();
        try {
            const masked = protectText(original);
            const raw = await this._api.translate(masked.text, 'auto', target, cancellable);
            if (cancellable.is_cancelled())
                return;
            const restored = restoreText(raw, masked.parts);
            entry.translated = restored.text;
            entry.warning = restored.warning;
            entry.status = 'Done';
            await this._history.save(this._settings.get_int('history-limit'), cancellable);
            if (cancellable.is_cancelled())
                return;
            this._updateMenu();
            const autoPaste = this._settings.get_boolean('auto-paste');
            const copyToClipboard = this._settings.get_boolean('copy-to-clipboard');
            if (!autoPaste && !copyToClipboard) {
                Main.notify('TranslatePlace', 'The translation is saved in history.');
                return;
            }
            if (autoPaste && global.display.focus_window !== window)
                throw new Error('The active window changed. The translation is saved in history.');
            if (await readClipboard(cancellable) !== original)
                throw new Error('The clipboard changed. The translation is saved in history.');
            St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, entry.translated);
            if (!autoPaste) {
                entry.status = 'Copied to clipboard';
                await this._history.save(this._settings.get_int('history-limit'), cancellable);
                if (!cancellable.is_cancelled()) {
                    this._updateMenu();
                    Main.notify('TranslatePlace', 'Translation copied to the clipboard.');
                }
                return;
            }
            await pause(90, cancellable);
            if (global.display.focus_window !== window)
                throw new Error('The active window changed. The translation is saved in history.');
            controlKey(this._device, 47); // Ctrl+V; the application still holds the original selection.
            entry.status = 'Paste sent';
            await this._history.save(this._settings.get_int('history-limit'), cancellable);
            if (!cancellable.is_cancelled())
                this._updateMenu();
        } catch (error) {
            if (cancellable.is_cancelled())
                return;
            entry.status = `Error: ${error.message}`;
            await this._history.save(this._settings.get_int('history-limit'), cancellable);
            this._updateMenu();
            throw error;
        }
    }
}
