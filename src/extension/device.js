// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2022 Andy Holmes <andrew.g.r.holmes@gmail.com>

/* exported MenuItem */

const { Clutter, Gio, GObject, St } = imports.gi;

const PopupMenu = imports.ui.popupMenu;

const ExtensionUtils = imports.misc.extensionUtils;
const Extension = ExtensionUtils.getCurrentExtension();

const Remote = Extension.imports.remote;


/**
 * Get an icon name, with high granularity.
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
const Battery = GObject.registerClass({
    GTypeName: 'ValentDeviceBattery',
    Properties: {
        'device': GObject.ParamSpec.object(
            'device',
            'Device',
            'The remote device',
            GObject.ParamFlags.READWRITE,
            Remote.Device.$gtype
        ),
    },
}, class Battery extends St.BoxLayout {
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

        this.connect('destroy', this._onDestroy);
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

    _onActionChanged(group, name) {
        if (group?.has_action(name)) {
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

    _onActionStateChanged(group, name, value) {
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

    _onDestroy(actor) {
        if (actor.device === null)
            return;

        for (const handlerId of actor._actionHandlerIds)
            actor.device.action_group.disconnect(handlerId);
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
});


/**
 * A menu item for devices.
 */
var MenuItem = GObject.registerClass({
    GTypeName: 'ValentDeviceMenuItem',
    Properties: {
        'device': GObject.ParamSpec.object(
            'device',
            'Device',
            'The remote device',
            GObject.ParamFlags.READWRITE,
            Remote.Device.$gtype
        ),
    },
}, class DeviceMenuItem extends PopupMenu.PopupBaseMenuItem {
    constructor(device) {
        super();

        // Workaround parameter parsing
        this.device = device;
        this._activatable = false;

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

        this._battery = new Battery({ visible: false });
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
        this.connect('destroy', this._onDestroy);
    }

    _onDestroy(actor) {
        if (actor.device === null)
            return;

        actor.device.disconnect(actor._stateChangedId);
    }

    _sync(device) {
        this.visible = (device.state & Remote.DeviceState.CONNECTED) !== 0 &&
                       (device.state & Remote.DeviceState.PAIRED) !== 0;
    }
});

