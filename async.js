// Copyright (C) 2026 Tomáš Mark
// SPDX-License-Identifier: GPL-3.0-or-later

import GLib from 'gi://GLib';

export async function pause(ms, cancellable) {
    let signal = 0;
    try {
        await new Promise((resolve, reject) => {
            if (cancellable.is_cancelled()) {
                reject(new Error('Cancelled'));
                return;
            }
            let source = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
                source = 0;
                resolve();
                return GLib.SOURCE_REMOVE;
            });
            signal = cancellable.connect(() => {
                if (source) {
                    GLib.Source.remove(source);
                    source = 0;
                }
                reject(new Error('Cancelled'));
            });
        });
    } finally {
        // Disconnect outside the cancellation callback to avoid a GIO deadlock.
        if (signal)
            cancellable.disconnect(signal);
    }
}
