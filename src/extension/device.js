// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2022 Andy Holmes <andrew.g.r.holmes@gmail.com>

/* exported Battery */

const { Clutter, Gio, GObject, Pango, St } = imports.gi;

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
var Battery = GObject.registerClass({
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
    constructor(params) {
        super(Object.assign({
            style_class: 'valent-device-battery',
        }, params));

        // Percentage Label
        this._label = new St.Label({
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;

        this.set_label_actor(this._label);
        this.add_child(this._label);

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

