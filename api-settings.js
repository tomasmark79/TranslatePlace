import GLib from 'gi://GLib';

export const DEFAULT_API_URL = 'http://127.0.0.1:5001';

export function normalizeApiUrl(value) {
    const input = value.trim();
    try {
        if (!input || /\s/.test(input))
            throw new Error();
        const uri = GLib.Uri.parse(input, GLib.UriFlags.ENCODED);
        if (!['http', 'https'].includes(uri.get_scheme()) || !uri.get_host() ||
            uri.get_userinfo() !== null || uri.get_query() !== null || uri.get_fragment() !== null)
            throw new Error();
        return uri.to_string().replace(/\/+$/, '');
    } catch {
        throw new Error('Enter an HTTP or HTTPS base URL without credentials, a query or a fragment.');
    }
}
