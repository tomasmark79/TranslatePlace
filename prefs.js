import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import {LANGUAGES, targetLanguage} from './languages.js';
import {DEFAULT_API_URL, normalizeApiUrl} from './api-settings.js';

export default class TranslatePlacePreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const page = new Adw.PreferencesPage({title: 'TranslatePlace', icon_name: 'preferences-desktop-locale-symbolic'});
        for (const secondary of [false, true]) {
            const number = secondary ? 2 : 1;
            const group = new Adw.PreferencesGroup({title: `TranslatePlace language ${number}`,
                description: 'Source language is detected automatically.'});
            page.add(group);
            const key = secondary ? 'secondary-target-language' : 'target-language';
            const language = new Adw.ComboRow({title: 'Target language',
                enable_search: true, model: Gtk.StringList.new(LANGUAGES.map(([, name]) => name))});
            const refresh = () => {
                language.selected = LANGUAGES.findIndex(([code]) => code === targetLanguage(settings, secondary));
            };
            refresh();
            language.connect('notify::selected', () => {
                const selected = LANGUAGES[language.selected];
                if (selected && selected[0] !== targetLanguage(settings, secondary))
                    settings.set_string(key, selected[0]);
            });
            const handler = settings.connect(`changed::${key}`, refresh);
            window.connect('close-request', () => { settings.disconnect(handler); return false; });
            group.add(language);
            this._addShortcut(window, group, settings,
                secondary ? 'translate-secondary-shortcut' : 'translate-shortcut',
                secondary ? 'translate-shortcut' : 'translate-secondary-shortcut');
        }

        const group = new Adw.PreferencesGroup({title: 'Translation'});
        page.add(group);
        const paste = new Adw.SwitchRow({title: 'Replace selected text',
            subtitle: 'Automatically paste the translation over the selection.'});
        settings.bind('auto-paste', paste, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(paste);
        const clipboard = new Adw.SwitchRow({title: 'Copy translation to clipboard',
            subtitle: 'Keep the translation ready to paste, even when text replacement is disabled.'});
        settings.bind('copy-to-clipboard', clipboard, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(clipboard);

        const history = new Adw.PreferencesGroup({title: 'History'});
        page.add(history);
        const count = Adw.SpinRow.new_with_range(1, 200, 1);
        count.title = 'Saved translations';
        settings.bind('history-limit', count, 'value', Gio.SettingsBindFlags.DEFAULT);
        history.add(count);

        const connection = new Adw.PreferencesGroup({title: 'Connection'});
        page.add(connection);
        const help = 'Base address used by both languages. Apply to save changes.';
        connection.description = help;
        const address = new Adw.EntryRow({title: 'Translation API URL', show_apply_button: true,
            text: settings.get_string('api-url')});
        address.connect('changed', () => {
            address.remove_css_class('error');
            connection.description = help;
        });
        address.connect('apply', () => {
            try {
                const url = normalizeApiUrl(address.text);
                if (!settings.set_string('api-url', url))
                    throw new Error('Could not save the API address.');
                address.text = url;
            } catch (error) {
                address.add_css_class('error');
                connection.description = error.message;
            }
        });
        const reset = new Gtk.Button({label: 'Default', valign: Gtk.Align.CENTER});
        reset.connect('clicked', () => { address.text = DEFAULT_API_URL; address.emit('apply'); });
        address.add_suffix(reset);
        connection.add(address);
        const addressHandler = settings.connect('changed::api-url', () => {
            address.text = settings.get_string('api-url');
        });
        window.connect('close-request', () => { settings.disconnect(addressHandler); return false; });
        window.add(page);
    }

    _addShortcut(window, group, settings, key, otherKey) {
        const row = new Adw.ActionRow({title: 'Keyboard shortcut'});
        const label = new Gtk.ShortcutLabel({valign: Gtk.Align.CENTER, disabled_text: 'Not assigned'});
        const refresh = () => { label.accelerator = settings.get_strv(key)[0] || ''; };
        refresh();
        const handler = settings.connect(`changed::${key}`, refresh);
        window.connect('close-request', () => { settings.disconnect(handler); return false; });
        row.add_suffix(label);
        const change = new Gtk.Button({label: 'Change…', valign: Gtk.Align.CENTER});
        row.add_suffix(change);
        row.activatable_widget = change;
        change.connect('clicked', () => this._captureShortcut(window, settings, key, otherKey));
        group.add(row);
    }

    _captureShortcut(window, settings, key, otherKey) {
        const dialog = new Adw.Window({title: 'Set keyboard shortcut', transient_for: window,
            modal: true, hide_on_close: false, default_width: 420, resizable: false});
        const box = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 16,
            margin_top: 24, margin_bottom: 24, margin_start: 24, margin_end: 24});
        const prompt = new Gtk.Label({label: 'Press a new shortcut.\nUse Ctrl, Alt or Super with another key.\nEscape cancels. Backspace removes the shortcut.', wrap: true});
        box.append(prompt);
        const cancel = new Gtk.Button({label: 'Cancel'});
        cancel.connect('clicked', () => dialog.close());
        box.append(cancel);
        dialog.content = box;
        const controller = new Gtk.EventControllerKey({propagation_phase: Gtk.PropagationPhase.CAPTURE});
        controller.connect('key-pressed', (_controller, keyval, _keycode, state) => {
            const mask = state & Gtk.accelerator_get_default_mod_mask();
            if (keyval === Gdk.KEY_Escape) {
                dialog.close();
                return true;
            }
            if (keyval === Gdk.KEY_BackSpace && !mask) {
                settings.set_strv(key, []);
                dialog.close();
                return true;
            }
            const modifiers = Gdk.ModifierType.CONTROL_MASK | Gdk.ModifierType.ALT_MASK | Gdk.ModifierType.SUPER_MASK;
            if (!(mask & modifiers) || !Gtk.accelerator_valid(keyval, mask))
                return true;
            const accelerator = Gtk.accelerator_name(Gdk.keyval_to_lower(keyval), mask);
            if (settings.get_strv(otherKey).some(value => {
                const [valid, otherKeyval, otherMask] = Gtk.accelerator_parse(value);
                return valid && Gdk.keyval_to_lower(otherKeyval) === Gdk.keyval_to_lower(keyval) && otherMask === mask;
            })) {
                prompt.label = 'This shortcut is already assigned to the other language.\nChoose a different shortcut.';
                return true;
            }
            settings.set_strv(key, [accelerator]);
            dialog.close();
            return true;
        });
        dialog.add_controller(controller);
        dialog.present();
    }
}
