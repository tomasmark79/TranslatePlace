import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {LANGUAGES, targetLanguage} from '../languages.js';

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const directory = GLib.dir_make_tmp('translateplace-settings-XXXXXX');
const schema = 'org.gnome.shell.extensions.translateplace';
try {
    const source = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().get_child(`schemas/${schema}.gschema.xml`);
    source.copy(Gio.File.new_for_path(`${directory}/${schema}.gschema.xml`), Gio.FileCopyFlags.NONE, null, null);
    const process = Gio.Subprocess.new(['glib-compile-schemas', '--strict', directory], Gio.SubprocessFlags.NONE);
    assert(process.wait_check(null), 'Schema compilation failed');
    const schemas = Gio.SettingsSchemaSource.new_from_directory(directory, Gio.SettingsSchemaSource.get_default(), false);
    const settings = new Gio.Settings({settings_schema: schemas.lookup(schema, false)});
    assert(!settings.get_boolean('copy-to-clipboard'), 'Clipboard copying should be opt-in');
    assert(settings.get_string('api-url') === 'http://127.0.0.1:5001', 'API default changed');
    assert(targetLanguage(settings) === 'en', 'Language 1 default changed');
    assert(targetLanguage(settings, true) === 'cs', 'Language 2 default changed');
    assert(settings.get_strv('translate-shortcut')[0] === '<Super><Shift>e', 'Existing shortcut changed');
    assert(settings.get_strv('translate-secondary-shortcut').length === 0, 'Second shortcut should start unassigned');
    settings.set_string('direction', 'en-cs');
    assert(targetLanguage(settings) === 'cs', 'Legacy direction lost');
    settings.set_string('target-language', 'en');
    assert(targetLanguage(settings) === 'en', 'Explicit target must override legacy direction');
    settings.set_string('secondary-target-language', 'de');
    assert(targetLanguage(settings) === 'en' && targetLanguage(settings, true) === 'de', 'Targets are not independent');
    settings.set_string('target-language', 'invalid');
    assert(targetLanguage(settings) === 'en', 'Invalid target has no fallback');
    assert(new Set(LANGUAGES.map(([code]) => code)).size === LANGUAGES.length, 'Duplicate language codes');
    print('Language settings tests passed.');
} finally {
    GLib.unlink(`${directory}/gschemas.compiled`);
    GLib.unlink(`${directory}/${schema}.gschema.xml`);
    GLib.rmdir(directory);
}
