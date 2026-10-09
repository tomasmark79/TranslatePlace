// Copyright (C) 2026 Tomáš Mark
// SPDX-License-Identifier: GPL-3.0-or-later

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

Gio._promisify(Soup.Session.prototype, 'send_and_read_async', 'send_and_read_finish');

import {DEFAULT_API_URL, normalizeApiUrl} from './api-settings.js';
const decoder = new TextDecoder();
const encoder = new TextEncoder();

export class TranslationApi {
    constructor(settings = null) {
        this._settings = settings;
        this._session = new Soup.Session({timeout: 20});
    }

    async _request(root, method, path, data, cancellable) {
        const message = Soup.Message.new(method, root + path);
        if (data !== null)
            message.set_request_body_from_bytes('application/json', new GLib.Bytes(encoder.encode(JSON.stringify(data))));
        const bytes = await this._session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, cancellable);
        const body = decoder.decode(bytes.get_data());
        if (message.status_code < 200 || message.status_code >= 300)
            throw new Error(`API HTTP ${message.status_code}: ${body.slice(0, 200)}`);
        return JSON.parse(body);
    }

    async translate(text, source, target, cancellable) {
        const root = normalizeApiUrl(this._settings?.get_string('api-url') ?? DEFAULT_API_URL);
        const started = await this._request(root, 'POST', '/translate', {q: text, source, target}, cancellable);
        if (!/^[0-9a-f]{32}$/.test(started.jobId ?? ''))
            throw new Error('The API did not return a valid translation ID.');
        for (let attempt = 0; attempt < 600; attempt++) {
            await delay(250, cancellable);
            const result = await this._request(root, 'GET', `/translations/${started.jobId}`, null, cancellable);
            if (result.status === 'done') {
                if (typeof result.translatedText !== 'string' || !result.translatedText)
                    throw new Error('The API returned an empty translation.');
                return result.translatedText;
            }
            if (result.status === 'failed')
                throw new Error(result.error || 'Translation failed.');
            if (result.status !== 'pending')
                throw new Error('The API returned an unknown translation status.');
        }
        throw new Error('Translation timed out.');
    }

    close() {
        this._session.abort();
    }
}

function delay(ms, cancellable) {
    return new Promise((resolve, reject) => {
        if (cancellable.is_cancelled()) {
            reject(new Error('Cancelled'));
            return;
        }
        let id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            cancellable.disconnect(signal);
            resolve();
            return GLib.SOURCE_REMOVE;
        });
        const signal = cancellable.connect(() => {
            if (id) {
                GLib.Source.remove(id);
                id = 0;
                reject(new Error('Cancelled'));
            }
        });
    });
}
