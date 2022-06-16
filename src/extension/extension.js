// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2022 Andy Holmes <andrew.g.r.holmes@gmail.com>
// SPDX-FileContributor: Michael Pobega <pobega@gmail.com>
// SPDX-FileContributor: McModder <me@modder.pw>

/* exported init, enable, disable */

const { GLib, GObject, Pango } = imports.gi;

const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const AggregateMenu = Main.panel.statusArea.aggregateMenu;

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
            throw Error(`Failed to create '${targetDir}`);

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
            throw Error(`Failed to create '${targetDir}`);

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
 * A System Indicator that's visible in the panel when devices are connected,
 * with menu items to start or stop the service and open the settings.
 */
const ServiceIndicator = GObject.registerClass({
    GTypeName: 'ValentServiceIndicator',
}, class ServiceIndicator extends PanelMenu.SystemIndicator {
    _init() {
        super._init();

        this._devices = new WeakMap();
        this.connect('destroy', this._onDestroy);

        // Service Proxy
        this.service = new Remote.Service();

        this._deviceAddedId = this.service.connect('device-added',
            this._onDeviceAdded.bind(this));

        this._deviceRemovedId = this.service.connect('device-removed',
            this._onDeviceRemoved.bind(this));

        this._serviceChangedId = this.service.connect('notify::active',
            this._onServiceChanged.bind(this));

        // Service Indicator
        this._indicator = this._addIndicator();
        this._indicator.icon_name = 'ca.andyholmes.Valent-symbolic';
        this._indicator.visible = false;
        AggregateMenu._indicators.insert_child_at_index(this, 0);

        // TRANSLATORS: The service is inactive
        this._item = new PopupMenu.PopupSubMenuMenuItem(_('Off'), true);
        this._item.icon.gicon = this._indicator.gicon;
        this._item.label.clutter_text.x_expand = true;
        this._item.label.ellipsize = Pango.EllipsizeMode.END;
        this._item.battery = new Device.Battery();
        this._item.insert_child_below(this._item.battery,
            this._item._triangleBin);
        this.menu.addMenuItem(this._item);

        // Try to place our menu below the network menu
        const menuItems = AggregateMenu.menu._getMenuItems();
        let networkIndex = menuItems.indexOf(AggregateMenu._network?.menu);
        AggregateMenu.menu.addMenuItem(this.menu, ++networkIndex || 4);

        // TRANSLATORS: A menu option to activate the service
        this._enableItem = this._item.menu.addAction(_('Turn On'),
            this._enable.bind(this));

        // TRANSLATORS: A menu option to open the service settings
        this._item.menu.addAction(_('Valent Settings'),
            () => this.service.activate_action('preferences', null));

        // Prime the service
        this.service.reload();
    }

    async _enable() {
        try {
            if (this.service.active)
                await this.service.stop();
            else
                await this.service.start();
        } catch (e) {
            logError(e, 'Valent');
        }
    }

    _sync() {
        const available = this.service.devices.filter(device => {
            return (device.state & Remote.DeviceState.CONNECTED) !== 0 &&
                   (device.state & Remote.DeviceState.PAIRED) !== 0;
        });

        // Hide status indicator if no devices are available
        this._indicator.visible = available.length > 0;
        this._item.battery.visible = available.length === 1;

        if (available.length === 1) {
            const device = available[0];
            this._item.label.text = device.name;
            this._item.battery.device = device;
        } else if (available.length > 0) {
            // TRANSLATORS: %d is the number of devices connected
            this._item.label.text = ngettext('%d Connected', '%d Connected',
                available.length).format(available.length);
            this._item.battery.device = null;
        } else if (this.service.active) {
            // TRANSLATORS: The service is active
            this._item.label.text = _('On');
            this._item.battery.device = null;
        } else {
            // TRANSLATORS: The service is inactive
            this._item.label.text = _('Off');
            this._item.battery.device = null;
        }
    }

    _onDeviceChanged(device, changed, _invalidated) {
        try {
            changed = changed.deepUnpack();

            if (changed.hasOwnProperty('Connected') ||
                changed.hasOwnProperty('Paired'))
                this._sync();
        } catch (e) {
            logError(e, 'Valent');
        }
    }

    _onDeviceAdded(service, device) {
        try {
            const handlerId = device.connect('g-properties-changed',
                this._onDeviceChanged.bind(this));
            this._devices.set(device, handlerId);

            this._sync();
        } catch (e) {
            logError(e, 'Valent');
        }
    }

    _onDeviceRemoved(service, device, sync = true) {
        try {
            const handlerId = this._devices.get(device);

            if (handlerId) {
                device.disconnect(handlerId);
                this._devices.delete(device);
            }

            if (sync)
                this._sync();
        } catch (e) {
            logError(e, 'Valent');
        }
    }

    _onServiceChanged(_service, _pspec) {
        try {
            if (this.service.active)
                // TRANSLATORS: A menu option to deactivate the service
                this._enableItem.label.text = _('Turn Off');
            else
                // TRANSLATORS: A menu option to activate the service
                this._enableItem.label.text = _('Turn On');

            this._sync();
        } catch (e) {
            logError(e, 'Valent');
        }
    }

    _onDestroy(actor) {
        if (actor.service) {
            actor.service.disconnect(actor._serviceChangedId);
            actor.service.disconnect(actor._deviceAddedId);
            actor.service.disconnect(actor._deviceRemovedId);

            for (const device of actor.service.devices)
                actor._onDeviceRemoved(actor.service, device, false);

            actor.service.destroy();
        }

        actor._item.destroy();
        actor.menu.destroy();
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
