import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';

function addText(box, title, content, width) {
    if (title) {
        const heading = new St.Label({text: title, style: 'font-weight: bold; margin-top: 12px;'});
        box.add_child(heading);
    }
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
        this.contentLayout.add_child(new St.Label({text: 'Translation history', style: 'font-weight: bold;'}));
        const box = new St.BoxLayout({vertical: true, style: 'padding: 8px;'});
        addText(box, 'Original text', entry.original, width);
        addText(box, 'Translation', entry.translated || entry.status, width);
        if (entry.warning)
            addText(box, 'Warning', entry.warning, width);
        const scroll = new St.ScrollView({style: `max-height: ${height}px;`,
            hscrollbar_policy: St.PolicyType.NEVER, vscrollbar_policy: St.PolicyType.AUTOMATIC,
            child: box});
        this.contentLayout.add_child(scroll);
        const buttons = [{label: 'Copy original', action: () => {
            St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, entry.original);
            this.close();
        }}];
        if (entry.translated)
            buttons.push({label: 'Copy translation', action: () => {
                St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, entry.translated);
                this.close();
            }});
        buttons.push({label: 'Close', action: () => this.close(), key: Clutter.KEY_Escape});
        this.setButtons(buttons);
    }
});


export const DeleteHistoryDialog = GObject.registerClass(
class DeleteHistoryDialog extends ModalDialog.ModalDialog {
    _init(count, onDelete) {
        super._init({destroyOnClose: true});
        this.contentLayout.add_child(new St.Label({text: 'Delete history?',
            style: 'font-weight: bold;'}));
        addText(this.contentLayout, '',
            `Delete all ${count} saved entries, including original texts and translations?`, 420);
        this.setButtons([
            {label: 'Cancel', action: () => this.close(), key: Clutter.KEY_Escape},
            {label: 'Delete all', action: () => { this.close(); onDelete(); }},
        ]);
    }
});
