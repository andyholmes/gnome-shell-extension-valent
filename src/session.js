// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: Andy Holmes <andrew.g.r.holmes@gmail.com>

import {ScreenShield} from 'resource:///org/gnome/shell/ui/screenShield.js';

// Overridden methods
const _deactivate = ScreenShield.prototype.deactivate;


/**
 * Patch the screenshield to wake up the screen when unlocked.
 */
export function enable() {
    ScreenShield.prototype.deactivate = function (animate) {
        this._wakeUpScreen();

        return _deactivate.call(this, animate);
    };
}

/**
 * Revert the patch to the screenshield.
 */
export function disable() {
    ScreenShield.prototype.deactivate = _deactivate;
}

