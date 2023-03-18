// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: Andy Holmes <andrew.g.r.holmes@gmail.com>

/* exported init, enable, disable */

const { Gio, GLib } = imports.gi;

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


/**
 * Install the Python plugin used by Valent to communicate with GNOME Shell.
 *
 * This function does nothing if the extension is installed as a system
 * extension.
 */
function installPlugin() {
    const datadir = GLib.get_user_data_dir();

    if (!Extension.path.startsWith(datadir))
        return;

    try {
        const sourceDir = GLib.build_filenamev([Extension.path, 'plugin',
            'gnome-shell']);
        const targetDir = GLib.build_filenamev([datadir, 'valent', 'plugins',
            'gnome-shell']);

        if (GLib.mkdir_with_parents(targetDir, 0o755) !== 0)
            throw Error(`Failed to create '${targetDir}'`);

        // gnome-shell.plugin
        const infoSource = GLib.build_filenamev([sourceDir,
            'gnome-shell.plugin']);
        const infoTarget = GLib.build_filenamev([targetDir,
            'gnome-shell.plugin']);
        const [, infoContents] = GLib.file_get_contents(infoSource);
        GLib.file_set_contents(infoTarget, infoContents);

        // gnome-shell/__init__.py
        const pluginDir = GLib.build_filenamev([targetDir, 'gnome-shell']);

        if (GLib.mkdir_with_parents(pluginDir, 0o755) !== 0)
            throw Error(`Failed to create '${pluginDir}'`);

        const pluginSource = GLib.build_filenamev([sourceDir, 'gnome-shell',
            '__init__.py']);
        const pluginTarget = GLib.build_filenamev([targetDir, 'gnome-shell',
            '__init__.py']);
        const [, pluginContents] = GLib.file_get_contents(pluginSource);
        GLib.file_set_contents(pluginTarget, pluginContents);
    } catch (e) {
        logError(e, 'Failed to install Python plugin');
    }
}


let serviceIndicator = null;
let clipboardInterface = null;


/** */
function init() {
    ExtensionUtils.initTranslations();

    // This installs the bundled Python plugin
    installPlugin();
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

