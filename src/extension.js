// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: Andy Holmes <andrew.g.r.holmes@gmail.com>

/* exported init */

const {Gio} = imports.gi;

const ExtensionUtils = imports.misc.extensionUtils;
const ExtensionMeta = ExtensionUtils.getCurrentExtension();

const Notification = ExtensionMeta.imports.notification;
const Session = ExtensionMeta.imports.session;
const Status = ExtensionMeta.imports.status;


/**
 * Get a `Gio.Icon` for a name.
 *
 * @param {string} name - An icon name
 * @returns {Gio.Icon} a `Gio.Icon`
 */
ExtensionMeta.getIcon = function (name) {
    return Gio.Icon.new_for_string(
        `file://${this.path}/icons/valent-${name}-symbolic.svg`);
};


class Extension {
    constructor() {
        this._indicator = null;
    }

    enable() {
        Notification.patchNotificationSources();
        Session.enable();

        this._indicator = new Status.Indicator();
    }

    /**
     * Disable the extension.
     *
     * The extension will be re-enabled in the `unlock-dialog` session mode so that
     * quick settings behave like other services, and modifications to components
     * like notifications will remain while Valent runs in the background.
     *
     * See: https://gjs.guide/extensions/review-guidelines/review-guidelines#session-modes
     */
    disable() {
        Notification.unpatchNotificationSources();
        Session.disable();

        this._indicator?.destroy();
        this._indicator = null;
    }
}


/** */
function init() {
    ExtensionUtils.initTranslations();

    return new Extension();
}

