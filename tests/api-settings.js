import Gio from 'gi://Gio';
import Soup from 'gi://Soup?version=3.0';
import {TranslationApi} from '../api.js';
import {DEFAULT_API_URL, normalizeApiUrl} from '../api-settings.js';
const assert = (condition, message) => { if (!condition) throw new Error(message); };
for (const [input, expected] of [
    [' http://127.0.0.1:5001/ ', DEFAULT_API_URL],
    ['https://translator.example:8443/api///', 'https://translator.example:8443/api'],
    ['http://[::1]:5001', 'http://[::1]:5001'],
    ['https://example.com/a%20b/', 'https://example.com/a%20b'],
])
    assert(normalizeApiUrl(input) === expected, `Incorrect normalization: ${input}`);
for (const input of ['', 'localhost:5001', 'file:///tmp/api', 'https://',
    'https://user:password@example.com', 'https://example.com?token=x',
    'https://example.com#fragment', 'https://example.com?', 'https://example.com#',
    'http://local host:5001', 'http://localhost:99999']) {
    let rejected = false;
    try { normalizeApiUrl(input); } catch { rejected = true; }
    assert(rejected, `Invalid URL accepted: ${input}`);
}
const server = new Soup.Server();
const calls = [];
server.add_handler(null, (_server, message, path) => {
    calls.push({path, method: message.get_method()});
    const result = message.get_method() === 'POST'
        ? {jobId: 'a'.repeat(32), status: 'pending'}
        : {status: 'done', translatedText: 'Hello'};
    message.set_status(message.get_method() === 'POST' ? 202 : 200, null);
    message.set_response('application/json', Soup.MemoryUse.COPY, JSON.stringify(result));
});
server.listen_local(0, Soup.ServerListenOptions.IPV4_ONLY);
let address = server.get_uris()[0].to_string().replace(/\/+$/, '') + '/prefix/';
const api = new TranslationApi({get_string: () => address});
try {
    await api.translate('Ahoj', 'auto', 'en', new Gio.Cancellable());
    assert(calls[0].path === '/prefix/translate', 'Configured base URL was not used for POST');
    assert(calls[1].path === `/prefix/translations/${'a'.repeat(32)}`, 'Polling did not use the configured base URL');
    address = address.replace('/prefix/', '/other');
    await api.translate('Hello', 'auto', 'cs', new Gio.Cancellable());
    assert(calls[2].path === '/other/translate', 'Changed address was not used');
    assert(calls[3].path === `/other/translations/${'a'.repeat(32)}`, 'Polling did not use the changed address');
    address = 'file:///tmp/api';
    let rejected = false;
    try { await api.translate('Hello', 'auto', 'cs', new Gio.Cancellable()); } catch { rejected = true; }
    assert(rejected && calls.length === 4, 'Invalid saved address sent a request');
    print('API address validation and configured HTTP requests passed.');
} finally {
    api.close();
    server.disconnect();
}
