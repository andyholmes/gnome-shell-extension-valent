// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: Andy Holmes <andrew.g.r.holmes@gmail.com>

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import * as Notification from './notification.js';
import * as Session from './session.js';
import * as Status from './status.js';


export default class ValentExtension extends Extension {
    enable() {
        Notification.enable();
        Session.enable();

        this._indicator = new Status.Indicator();
    }

    /**
     * Disable the extension.
     *
     * The extension will be re-enabled in the `unlock-dialog` session mode so
     * that quick settings behave like other services, and modifications to
     * components will remain while Valent runs in the background.
     *
     * See: https://gjs.guide/extensions/review-guidelines/review-guidelines#session-modes
     */
    disable() {
        Notification.disable();
        Session.disable();

        this._indicator?.destroy();
        this._indicator = null;
    }
}

