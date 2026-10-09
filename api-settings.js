// Copyright (C) 2026 Tomáš Mark
// SPDX-License-Identifier: GPL-3.0-or-later

import GLib from 'gi://GLib';

export const DEFAULT_API_URL = 'http://127.0.0.1:5001';

export function normalizeApiUrl(value) {
    const input = value.trim();
    const message = 'Enter an HTTP or HTTPS base URL without credentials, a query or a fragment.';
    if (!input || /\s/.test(input))
        throw new Error(message);
    let uri;
    try {
        uri = GLib.Uri.parse(input, GLib.UriFlags.ENCODED);
    } catch (error) {
        throw new Error(message, {cause: error});
    }
    if (!['http', 'https'].includes(uri.get_scheme()) || !uri.get_host() ||
        uri.get_userinfo() !== null || uri.get_query() !== null || uri.get_fragment() !== null)
        throw new Error(message);
    return uri.to_string().replace(/\/+$/, '');
}
