// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: Andy Holmes <andrew.g.r.holmes@gmail.com>

import {Extension, InjectionManager} from 'resource:///org/gnome/shell/extensions/extension.js';

import * as Notification from './notification.js';
import * as Status from './status.js';


export default class ValentExtension extends Extension {
    enable() {
        this._injectionManager = new InjectionManager();

        Notification.enable(this._injectionManager);
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
        this._indicator?.destroy();
        this._indicator = null;
        Notification.disable(this._injectionManager);

        this._injectionManager.clear();
        this._injectionManager = null;
    }
}

