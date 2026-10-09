// Copyright (C) 2026 Tomáš Mark
// SPDX-License-Identifier: GPL-3.0-or-later

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

Gio._promisify(Gio.File.prototype, 'load_contents_async', 'load_contents_finish');
Gio._promisify(Gio.File.prototype, 'replace_contents_async', 'replace_contents_finish');

export class History {
    constructor() {
        const directory = GLib.build_filenamev([GLib.get_user_state_dir(), 'translateplace']);
        GLib.mkdir_with_parents(directory, 0o700);
        this._file = Gio.File.new_for_path(GLib.build_filenamev([directory, 'history.json']));
        this.entries = [];
        this._queue = Promise.resolve();
    }

    async load(cancellable) {
        try {
            const [bytes] = await this._file.load_contents_async(cancellable);
            const parsed = JSON.parse(new TextDecoder().decode(bytes));
            if (Array.isArray(parsed))
                this.entries = parsed.filter(item => typeof item.original === 'string').slice(0, 200);
        } catch (error) {
            if (!error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
                throw error;
        }
    }

    save(limit, cancellable) {
        const snapshot = JSON.stringify(this.entries.slice(0, limit));
        this._queue = this._queue.catch(() => {}).then(async () => {
            await this._file.replace_contents_async(new TextEncoder().encode(snapshot), null, false,
                Gio.FileCreateFlags.PRIVATE, cancellable);
        });
        return this._queue;
    }

    clear(limit, cancellable) {
        const previous = this.entries;
        const empty = [];
        this.entries = empty;
        return this.save(limit, cancellable).catch(error => {
            this.entries = this.entries === empty
                ? previous : [...this.entries, ...previous].slice(0, limit);
            throw error;
        });
    }

    add(entry, limit, cancellable) {
        this.entries.unshift(entry);
        this.entries.length = Math.min(this.entries.length, limit);
        return this.save(limit, cancellable);
    }
}
