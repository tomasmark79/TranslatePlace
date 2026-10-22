// Copyright (C) 2026 Tomáš Mark
// SPDX-License-Identifier: GPL-3.0-or-later

import Gio from 'gi://Gio';
import {pause} from '../async.js';

function assert(condition, message) {
    if (!condition)
        throw new Error(message);
}

function trackedCancellable() {
    const real = new Gio.Cancellable();
    const handlers = new Set();
    return {
        handlers,
        is_cancelled: () => real.is_cancelled(),
        cancel: () => real.cancel(),
        connect(callback) {
            const id = real.connect(callback);
            handlers.add(id);
            return id;
        },
        disconnect(id) {
            real.disconnect(id);
            assert(handlers.delete(id), 'Cancellation handler disconnected twice');
        },
    };
}

const success = trackedCancellable();
await pause(1, success);
assert(success.handlers.size === 0, 'Cancellation handler survived timeout completion');
success.cancel();

const cancelled = trackedCancellable();
const pending = pause(60000, cancelled);
cancelled.cancel();
let error;
try {
    await pending;
} catch (caught) {
    error = caught;
}
assert(error?.message === 'Cancelled', 'Cancellation was not reported');
assert(cancelled.handlers.size === 0, 'Cancellation handler survived cancellation');

error = null;
try {
    await pause(60000, cancelled);
} catch (caught) {
    error = caught;
}
assert(error?.message === 'Cancelled', 'Already cancelled wait did not reject');
assert(cancelled.handlers.size === 0, 'Already cancelled wait connected a handler');
print('Timer completion and cancellation cleanup passed.');
