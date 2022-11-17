// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2022 Andy Holmes <andrew.g.r.holmes@gmail.com>

/* exported Indicator */

const { Clutter, Gio, GObject, St } = imports.gi;

const Main = imports.ui.main;
const PopupMenu = imports.ui.popupMenu;
const QuickSettings = imports.ui.quickSettings;
const QuickSettingsMenu = Main.panel.statusArea.quickSettings;

const ExtensionUtils = imports.misc.extensionUtils;
const Extension = ExtensionUtils.getCurrentExtension();

const Remote = Extension.imports.remote;

const _ = ExtensionUtils.gettext;
const ngettext = ExtensionUtils.ngettext;


/**
 * Get an battery icon name, with high granularity.
 *
 * @param {number} percentage - an integer between -1.0 and 100.0
 * @param {boolean} charging - whether the battery is charging
 * @returns {string} a themed icon name
 */
function _getBatteryIcon(percentage, charging) {
    // This is particular to KDE Connect
    if (percentage < 0)
        return 'battery-missing-symbolic';

    if (percentage >= 100)
        return 'battery-level-100-charged-symbolic';

    const level = Math.floor(percentage / 10) * 10;

    return charging
        ? `battery-level-${level}-charging-symbolic`
        : `battery-level-${level}-symbolic`;
}


/**
 * A battery widget with an icon and text percentage.
 */
const DeviceBattery = GObject.registerClass({
    GTypeName: 'ValentDeviceBattery',
    Properties: {
        'device': GObject.ParamSpec.object(
            'device',
            'Device',
            'The remote device',
            GObject.ParamFlags.READWRITE,
            Remote.Device
        ),
    },
}, class DeviceBattery extends St.BoxLayout {
    constructor(params = {}) {
        super({
            style_class: 'valent-device-battery',
            ...params,
        });

        // Percentage Label
        this._label = new St.Label({
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this._label);
        this.label_actor = this._label;

        // Battery Icon
        this._icon = new St.Icon({
            fallback_icon_name: 'battery-missing-symbolic',
            icon_size: 16,
        });
        this.add_child(this._icon);

        this.connect('destroy', this._onDestroy.bind(this));
    }

    get device() {
        if (this._device === undefined)
            this._device = null;

        return this._device;
    }

    set device(device) {
        if (this.device === device)
            return;

        this._connectDevice(device);

        this._device = device;
        this.notify('device');
    }

    _connectDevice(device = null) {
        if (this.device !== null) {
            for (const handlerId of this._actionHandlerIds)
                this.device.action_group.disconnect(handlerId);
            this._actionHandlerIds = [];
        }

        if (device) {
            this._actionHandlerIds = [
                device.action_group.connect('action-added::battery.state',
                    this._onActionChanged.bind(this)),
                device.action_group.connect('action-removed::battery.state',
                    this._onActionChanged.bind(this)),
                device.action_group.connect('action-enabled-changed::battery.state',
                    this._onActionEnabledChanged.bind(this)),
                device.action_group.connect('action-state-changed::battery.state',
                    this._onActionStateChanged.bind(this)),
            ];
        }

        this._onActionChanged(device?.action_group, 'battery.state');
    }

    _onActionChanged(group, name) {
        if (group?.get_action_enabled(name)) {
            const value = group.get_action_state(name);
            this._onActionStateChanged(group, name, value);
        } else {
            this.visible = false;
        }
    }

    _onActionEnabledChanged(group, name, enabled) {
        this.visible = enabled;

        if (this.visible)
            this._onActionChanged(group, name);
    }

    _onActionStateChanged(_group, name, value) {
        const {
            charging = false,
            percentage = 0.0,
            'icon-name': iconFallback = 'battery-missing-symbolic',
            'is-present': isPresent = false,
        } = value.recursiveUnpack();

        // Disable GThemedIcon's default fallbacks
        this._icon.gicon = new Gio.ThemedIcon({
            name: _getBatteryIcon(percentage, charging),
            use_default_fallbacks: false,
        });
        this._icon.fallback_icon_name = iconFallback;

        this._label.text = isPresent ? `${Math.floor(percentage)}%` : '';
        this.visible = isPresent;
    }

    _onDestroy(_actor) {
        if (this.device === null)
            return;

        for (const handlerId of this._actionHandlerIds)
            this.device.action_group.disconnect(handlerId);
    }
});


/**
 * A menu item for devices.
 */
const DeviceMenuItem = GObject.registerClass({
    GTypeName: 'ValentDeviceMenuItem',
    Properties: {
        'device': GObject.ParamSpec.object(
            'device',
            'Device',
            'The remote device',
            GObject.ParamFlags.READWRITE,
            Remote.Device
        ),
    },
}, class DeviceMenuItem extends PopupMenu.PopupBaseMenuItem {
    constructor(device) {
        super();

        // Workaround parameter parsing
        this.device = device;

        this._icon = new St.Icon({
            fallback_icon_name: 'computer-symbolic',
            style_class: 'popup-menu-icon',
        });
        this.add_child(this._icon);

        this._label = new St.Label({
            x_expand: true,
            y_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this._label);
        this.label_actor = this._label;

        this._battery = new DeviceBattery({ visible: false });
        this.add_child(this._battery);

        this.bind_property('device', this._battery, 'device',
            GObject.BindingFlags.SYNC_CREATE);
        this.device.bind_property('icon-name', this._icon, 'icon-name',
            GObject.BindingFlags.SYNC_CREATE);
        this.device.bind_property('name', this._label, 'text',
            GObject.BindingFlags.SYNC_CREATE);
        this._stateChangedId = this.device.connect('notify::state',
            this._sync.bind(this));

        this._sync(this.device);
        this.connect('destroy', this._onDestroy.bind(this));
    }

    _onDestroy(_actor) {
        this.device.disconnect(this._stateChangedId);
    }

    _sync(device, _pspec) {
        this.visible = (device.state & Remote.DeviceState.CONNECTED) !== 0 &&
                       (device.state & Remote.DeviceState.PAIRED) !== 0;
    }
});


/**
 * The quick settings menu for Valent.
 */
const MenuToggle = GObject.registerClass({
    GTypeName: 'ValentMenuToggle',
    Properties: {
        'service': GObject.ParamSpec.object(
            'service',
            'Service',
            'The remote service',
            GObject.ParamFlags.READWRITE,
            Remote.Service.$gtype
        ),
    },
}, class MenuToggle extends QuickSettings.QuickMenuToggle {
    constructor(params = {}) {
        super({
            label: _('Valent'),
            toggle_mode: true,
            ...params,
        });

        this._activeIcon = Gio.Icon.new_for_string(
            `file://${Extension.path}/data/phonelink-symbolic.svg`);
        this._inactiveIcon = Gio.Icon.new_for_string(
            `file://${Extension.path}/data/phonelink-off-symbolic.svg`);

        this.menu.setHeader('ca.andyholmes.Valent-symbolic',
            _('Device Connections'));

        this._devices = new WeakMap();
        this._devicesSection = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._devicesSection);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // TRANSLATORS: A menu option to open the main window
        this._serviceItem = this.menu.addSettingsAction(_('All Devices'),
            'ca.andyholmes.Valent.desktop');

        this._activeChangedId = this.service.connect('notify::active',
            this._sync.bind(this));
        this._deviceAddedId = this.service.connect('device-added',
            this._onDeviceAdded.bind(this));
        this._deviceRemovedId = this.service.connect('device-removed',
            this._onDeviceRemoved.bind(this));

        this._sync();
        this.connect('destroy', this._onDestroy.bind(this));
    }

    vfunc_clicked(_clickedButton) {
        if (this.service.active)
            this.service.activate_action('quit');
        else
            this.service.activate();
    }

    _onDestroy(_actor) {
        this.service.disconnect(this._activeChangedId);
        this.service.disconnect(this._deviceAddedId);
        this.service.disconnect(this._deviceRemovedId);
    }

    _onDeviceActivated(item) {
        Main.overview.hide();
        Main.panel.closeQuickSettings();

        const target = item.device.get_cached_property('Id');
        this.service.activate_action('window', target);
    }

    _onDeviceAdded(_service, device) {
        const menuItem = new DeviceMenuItem(device);
        menuItem.connect('activate', this._onDeviceActivated.bind(this));
        this._devicesSection.addMenuItem(menuItem);

        this._serviceItem.bind_property('visible', menuItem, 'reactive',
            GObject.BindingFlags.SYNC_CREATE);

        const stateChangedId = device.connect('notify::state',
            this._sync.bind(this));

        this._devices.set(device, [menuItem, stateChangedId]);
        this._sync();
    }

    _onDeviceRemoved(_service, device) {
        const [menuItem, stateChangedId] = this._devices.get(device) ?? [];

        if (menuItem)
            menuItem.destroy();

        if (stateChangedId)
            device.disconnect(stateChangedId);

        this._devices.delete(device);
        this._sync();
    }

    _sync() {
        const available = this.service.devices.filter(device => {
            return (device.state & Remote.DeviceState.CONNECTED) !== 0 &&
                   (device.state & Remote.DeviceState.PAIRED) !== 0;
        });

        if (available.length === 1) {
            this.label = available[0].name;
        } else if (available.length > 0) {
            // TRANSLATORS: %d is the number of devices connected
            this.label = ngettext('%d Connected', '%d Connected',
                available.length).format(available.length);
        } else {
            // TRANSLATORS: The quick settings item label
            this.label = _('Valent');
        }

        this.checked = this.service.active;
        this.gicon = this.service.active
            ? this._activeIcon
            : this._inactiveIcon;
    }
});


/**
 * The service indicator for Valent.
 */
var Indicator = GObject.registerClass({
    GTypeName: 'ValentIndicator',
}, class Indicator extends QuickSettings.SystemIndicator {
    constructor() {
        super();

        // Service Proxy
        this._devices = new WeakMap();
        this._service = new Remote.Service();
        this._service.connect('device-added',
            this._onDeviceAdded.bind(this));
        this._service.connect('device-removed',
            this._onDeviceRemoved.bind(this));

        // Indicator Icon
        this._icon = this._addIndicator();
        this._icon.icon_name = 'ca.andyholmes.Valent-symbolic';
        this._icon.visible = false;

        // Service Toggle
        const menuToggle = new MenuToggle({ service: this._service });
        this.quickSettingsItems.push(menuToggle);

        QuickSettingsMenu._addItems(this.quickSettingsItems);
        QuickSettingsMenu._indicators.insert_child_at_index(this, 0);
        this.connect('destroy', this._onDestroy.bind(this));
    }

    _onDestroy(_actor) {
        this._service.destroy();
        this.quickSettingsItems.forEach(item => item.destroy());
    }

    _onDeviceAdded(_service, device) {
        const stateChangedId = device.connect('notify::state',
            this._sync.bind(this));

        this._devices.set(device, stateChangedId);
        this._sync();
    }

    _onDeviceRemoved(_service, device) {
        const stateChangedId = this._devices.get(device);

        if (stateChangedId)
            device.disconnect(stateChangedId);

        this._devices.delete(device);
        this._sync();
    }

    _sync() {
        const available = this._service.devices.filter(device => {
            return (device.state & Remote.DeviceState.CONNECTED) !== 0 &&
                   (device.state & Remote.DeviceState.PAIRED) !== 0;
        });

        this._icon.visible = available.length > 0;
    }
});

