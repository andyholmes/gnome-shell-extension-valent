// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: Andy Holmes <andrew.g.r.holmes@gmail.com>

/* exported enable, disable */

const { ScreenShield } = imports.ui.screenShield;

// Overridden methods
const _deactivate = ScreenShield.prototype.deactivate;


/**
 * Patch the screenshield to wake up the screen when unlocked.
 */
function enable() {
    ScreenShield.prototype.deactivate = function (animate) {
        this._wakeUpScreen();

        return _deactivate.call(this, animate);
    };
}

/**
 * Revert the patch to the screenshield.
 */
function disable() {
    ScreenShield.prototype.deactivate = _deactivate;
}

