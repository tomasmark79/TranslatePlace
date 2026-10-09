const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('GNOME translation supports four minutes and times out after fifteen', async () => {
    for (const completes of [true, false]) {
        let elapsed = 0;
        const context = vm.createContext({
            TextDecoder, TextEncoder,
            Gio: {_promisify() {}}, Soup: {Session: class {}},
            GLib: {get_monotonic_time: () => elapsed * 1000},
            DEFAULT_API_URL: 'http://127.0.0.1:5001', normalizeApiUrl: value => value,
            advance: ms => {elapsed += ms;},
        });
        const source = fs.readFileSync(path.join(__dirname, '../api.js'), 'utf8')
            .replace(/^import .*;\n/gm, '').replace('export class TranslationApi', 'class TranslationApi');
        vm.runInContext(source + `
            globalThis.TranslationApi = TranslationApi;
            delay = async ms => advance(ms);
        `, context);
        const api = new context.TranslationApi();
        api._request = async (_root, method) => method === 'POST'
            ? {jobId: 'a'.repeat(32)}
            : completes && elapsed >= 240000
                ? {status: 'done', translatedText: 'Long translation'} : {status: 'pending'};
        if (completes) {
            assert.equal(await api.translate('Long text', 'auto', 'en', {}), 'Long translation');
            assert.equal(elapsed, 240000);
        } else {
            await assert.rejects(api.translate('Long text', 'auto', 'en', {}), /Translation timed out/);
            assert.equal(elapsed, 900000);
        }
    }
});
