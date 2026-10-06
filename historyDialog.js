import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';

function addText(box, title, content, width) {
    const heading = new St.Label({text: title, style: 'font-weight: bold; margin-top: 12px;'});
    box.add_child(heading);
    const label = new St.Label({text: content || '—', style: `width: ${width - 48}px;`});
    const text = label.get_clutter_text();
    text.set_line_wrap(true);
    text.set_line_wrap_mode(Pango.WrapMode.WORD_CHAR);
    box.add_child(label);
}

export const HistoryDialog = GObject.registerClass(
class HistoryDialog extends ModalDialog.ModalDialog {
    _init(entry) {
        super._init({destroyOnClose: true});
        const width = Math.max(320, Math.min(620, global.stage.width - 80));
        const height = Math.max(160, Math.min(520, global.stage.height - 180));
        this.contentLayout.style = `width: ${width}px;`;
        this.contentLayout.add_child(new St.Label({text: 'Historie překladu', style: 'font-weight: bold;'}));
        const box = new St.BoxLayout({vertical: true, style: 'padding: 8px;'});
        addText(box, 'Původní text', entry.original, width);
        addText(box, 'Překlad', entry.translated || entry.status, width);
        if (entry.warning)
            addText(box, 'Upozornění', entry.warning, width);
        const scroll = new St.ScrollView({style: `max-height: ${height}px;`,
            hscrollbar_policy: St.PolicyType.NEVER, vscrollbar_policy: St.PolicyType.AUTOMATIC,
            child: box});
        this.contentLayout.add_child(scroll);
        const buttons = [];
        if (entry.translated)
            buttons.push({label: 'Zkopírovat překlad', action: () => {
                St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, entry.translated);
                this.close();
            }});
        buttons.push({label: 'Zavřít', action: () => this.close(), key: Clutter.KEY_Escape});
        this.setButtons(buttons);
    }
});
