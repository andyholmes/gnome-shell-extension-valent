// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2022 Andy Holmes <andrew.g.r.holmes@gmail.com>

/* exported init, enable, disable */

const { GLib, GObject } = imports.gi;

const Main = imports.ui.main;
const PopupMenu = imports.ui.popupMenu;
const QuickSettings = imports.ui.quickSettings;
const QuickSettingsMenu = Main.panel.statusArea.quickSettings;

const ExtensionUtils = imports.misc.extensionUtils;
const Extension = ExtensionUtils.getCurrentExtension();

const Clipboard = Extension.imports.clipboard;
const Device = Extension.imports.device;
const Notification = Extension.imports.notification;
const Remote = Extension.imports.remote;

const _ = ExtensionUtils.gettext;
const ngettext = ExtensionUtils.ngettext;


/**
 * If installed as a user extension, copy the bundled Python plugin to the
 * user plugins directory for Valent.
 *
 * TODO: avoid copying unchanged files
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


/**
 * The quick settings menu for Valent.
 */
const ServiceMenuToggle = GObject.registerClass({
    GTypeName: 'ValentServiceMenuToggle',
    Properties: {
        'service': GObject.ParamSpec.object(
            'service',
            'Service',
            'The remote service',
            GObject.ParamFlags.READWRITE,
            Remote.Service.$gtype
        ),
    },
}, class ServiceToggle extends QuickSettings.QuickMenuToggle {
    constructor(params = {}) {
        super({
            label: _('Valent'),
            icon_name: 'ca.andyholmes.Valent-symbolic',
            toggle_mode: true,
            ...params,
        });

        this._items = new Map();

        this.menu.setHeader('ca.andyholmes.Valent-symbolic',
            _('Device Connections'));

        this._itemsSection = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._itemsSection);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // TRANSLATORS: A menu option to open the service settings
        const settingsItem = this.menu.addAction(_('Valent Settings'),
            this._onSettingsActivated.bind(this));
        settingsItem.visible = Main.sessionMode.allowSettings;
        this.menu._settingsActions['ca.andyholme.Valent.desktop'] = settingsItem;

        this.service.bind_property('active', this, 'checked',
            GObject.BindingFlags.SYNC_CREATE);
        this._deviceAddedId = this.service.connect('device-added',
            this._onDeviceAdded.bind(this));
        this._deviceRemovedId = this.service.connect('device-removed',
            this._onDeviceRemoved.bind(this));

        this.connect('destroy', this._onDestroy);
    }

    vfunc_clicked(_clickedButton) {
        console.debug('toggling service');

        if (this.service.active)
            this.service.stop().catch(logError);
        else
            this.service.start().catch(logError);
    }

    _onDestroy(actor) {
        if (actor._deviceAddedId)
            actor.service.disconnect(actor._deviceAddedId);

        if (actor._deviceRemovedId)
            actor.service.disconnect(actor._deviceRemovedId);
    }

    _onDeviceAdded(service_, device) {
        const item = new Device.MenuItem(device);

        this._items.set(device, item);
        this._itemsSection.addMenuItem(item);

        this._sync();
    }

    _onDeviceRemoved(service_, device) {
        const item = this._items.get(device);

        if (item) {
            this._items.delete(device);
            item.destroy();
        }

        this._sync();
    }

    _onSettingsActivated(_event) {
        this.service.activate_action('preferences');

        Main.overview.hide();
        Main.panel.closeQuickSettings();
    }

    _sync() {
        const available = this.service.devices.filter(device => {
            return (device.state & Remote.DeviceState.CONNECTED) !== 0 &&
                   (device.state & Remote.DeviceState.PAIRED) !== 0;
        });
        const nAvailableDevices = available.length;

        if (nAvailableDevices === 1) {
            this.label = available[0].name;
        } else if (nAvailableDevices > 0) {
            // TRANSLATORS: %d is the number of devices connected
            this.label = ngettext('%d Connected', '%d Connected',
                available.length).format(available.length);
        } else {
            // TRANSLATORS: The quick settings item label
            this.label = _('Valent');
        }
    }
});


/**
 * A System Indicator that's visible in the panel when devices are connected,
 * with menu items to start or stop the service and open the settings.
 */
const ServiceIndicator = GObject.registerClass({
    GTypeName: 'ValentServiceIndicator',
}, class ServiceIndicator extends QuickSettings.SystemIndicator {
    constructor() {
        super();

        this.connect('destroy', this._onDestroy);

        // Service Proxy
        this.service = new Remote.Service();
        this._deviceAddedId = this.service.connect('device-added',
            this._onDeviceAdded.bind(this));
        this._deviceRemovedId = this.service.connect('device-removed',
            this._sync.bind(this));

        // Service Indicator
        this._indicator = this._addIndicator();
        this._indicator.icon_name = 'ca.andyholmes.Valent-symbolic';
        this._indicator.visible = false;
        QuickSettingsMenu._indicators.insert_child_at_index(this, 0);

        // Service Toggle
        const menuToggle = new ServiceMenuToggle({
            service: this.service,
        });
        this.quickSettingsItems.push(menuToggle);
        QuickSettingsMenu._addItems(this.quickSettingsItems);

        // Prime the service
        this.service.reload();
    }

    _onDestroy(actor) {
        if (actor.service) {
            actor.service.disconnect(actor._deviceAddedId);
            actor.service.disconnect(actor._deviceRemovedId);
            actor.service.destroy();
        }

        actor.quickSettingsItems.forEach(item => item.destroy());
    }

    _onDeviceAdded(service_, device) {
        device.connect('notify::state', this._sync.bind(this));
        this._sync();
    }

    _sync() {
        const available = this.service.devices.filter(device => {
            return (device.state & Remote.DeviceState.CONNECTED) !== 0 &&
                   (device.state & Remote.DeviceState.PAIRED) !== 0;
        });

        this._indicator.visible = available.length > 0;
    }
});


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

    if (serviceIndicator === null)
        serviceIndicator = new ServiceIndicator();

    if (clipboardInterface === null)
        clipboardInterface = new Clipboard.Clipboard();
}


/** */
function disable() {
    Notification.unpatchNotificationSources();

    if (serviceIndicator !== null) {
        serviceIndicator.destroy();
        serviceIndicator = null;
    }

    if (clipboardInterface !== null) {
        clipboardInterface.destroy();
        clipboardInterface = null;
    }
}

