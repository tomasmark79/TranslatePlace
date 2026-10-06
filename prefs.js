import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class TranslatePlacePreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const page = new Adw.PreferencesPage({title: 'TranslatePlace', icon_name: 'preferences-desktop-locale-symbolic'});
        const group = new Adw.PreferencesGroup({title: 'Překlad'});
        page.add(group);

        const direction = new Adw.ComboRow({title: 'Výchozí směr',
            model: Gtk.StringList.new(['Čeština → angličtina', 'Angličtina → čeština'])});
        direction.selected = settings.get_string('direction') === 'en-cs' ? 1 : 0;
        direction.connect('notify::selected', () => settings.set_string('direction',
            direction.selected === 1 ? 'en-cs' : 'cs-en'));
        group.add(direction);

        const paste = new Adw.SwitchRow({title: 'Nahradit označený text',
            subtitle: 'Když je vypnuto, překlad zůstane jen v historii.'});
        settings.bind('auto-paste', paste, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(paste);

        const history = new Adw.PreferencesGroup({title: 'Historie'});
        page.add(history);
        const count = Adw.SpinRow.new_with_range(1, 200, 1);
        count.title = 'Počet uložených překladů';
        count.value = settings.get_int('history-limit');
        count.connect('notify::value', () => settings.set_int('history-limit', Math.round(count.value)));
        history.add(count);

        const shortcut = new Adw.PreferencesGroup({title: 'Použití'});
        page.add(shortcut);
        shortcut.add(new Adw.ActionRow({title: 'Klávesová zkratka', subtitle: 'Super+Shift+E'}));
        shortcut.add(new Adw.ActionRow({title: 'Místní API', subtitle: 'http://127.0.0.1:5001'}));
        window.add(page);
    }
}
