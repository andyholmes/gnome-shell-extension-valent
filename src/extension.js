// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: Andy Holmes <andrew.g.r.holmes@gmail.com>

/* exported init, enable, disable */

const { Gio } = imports.gi;

const ExtensionUtils = imports.misc.extensionUtils;
const Extension = ExtensionUtils.getCurrentExtension();

const Clipboard = Extension.imports.clipboard;
const Notification = Extension.imports.notification;
const Session = Extension.imports.session;
const Status = Extension.imports.status;


/**
 * Get a `Gio.Icon` for a name.
 *
 * @param {string} name - An icon name
 * @returns {Gio.Icon} a `Gio.Icon`
 */
Extension.getIcon = function (name) {
    return Gio.Icon.new_for_string(
        `file://${this.path}/icons/valent-${name}-symbolic.svg`);
};


let serviceIndicator = null;
let clipboardInterface = null;


/** */
function init() {
    ExtensionUtils.initTranslations();
}


/** */
function enable() {
    Notification.patchNotificationSources();
    Session.enable();

    if (serviceIndicator === null)
        serviceIndicator = new Status.Indicator();

    if (clipboardInterface === null)
        clipboardInterface = new Clipboard.Clipboard();
}


/** */
function disable() {
    Notification.unpatchNotificationSources();
    Session.disable();

    serviceIndicator?.destroy();
    serviceIndicator = null;

    clipboardInterface?.destroy();
    clipboardInterface = null;
}

