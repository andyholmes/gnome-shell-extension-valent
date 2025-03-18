// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: Andy Holmes <andrew.g.r.holmes@gmail.com>

import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import Pango from 'gi://Pango';
import Clutter from 'gi://Clutter';
import St from 'gi://St';
import Shell from 'gi://Shell';

import {Extension, gettext as _, ngettext} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as QuickSettings from 'resource:///org/gnome/shell/ui/quickSettings.js';

import * as Remote from './remote.js';


/**
 * Get an battery icon name, with high granularity.
 *
 * @param {number} percentage - an integer between -1.0 and 100.0
 * @param {boolean} charging - whether the battery is charging
 * @returns {string} a themed icon name
 */
function _getBatteryIconName(percentage, charging) {
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
 * Get a `Gio.Icon` for a name.
 *
 * @param {string} name - An icon name
 * @returns {Gio.Icon} a `Gio.Icon`
 */
function _getIcon(name) {
    const dir = Gio.File.new_for_uri(import.meta.url).get_parent();
    return Gio.Icon.new_for_string(
        `${dir.get_uri()}/icons/valent-${name}-symbolic.svg`);
}


/**
 * A battery widget with an icon and text percentage.
 */
class DeviceBattery extends St.BoxLayout {
    static {
        this[GObject.properties] = {
            'device': GObject.ParamSpec.object('device', null, null,
                GObject.ParamFlags.READWRITE, Remote.Device),
        };
        GObject.registerClass(this);
    }

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
    }

    get device() {
        if (this._device === undefined)
            this._device = null;

        return this._device;
    }

    set device(device) {
        if (this.device === device)
            return;

        this._bindDevice(device);

        this._device = device;
        this.notify('device');
    }

    _bindDevice(device = null) {
        this.device?.action_group.disconnectObject(this);
        device?.action_group.connectObject(
            'action-added::battery.state', this._onActionChanged.bind(this),
            'action-removed::battery.state', this._onActionChanged.bind(this),
            'action-enabled-changed::battery.state', this._onActionEnabledChanged.bind(this),
            'action-state-changed::battery.state', this._onActionStateChanged.bind(this),
            this);

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
            name: _getBatteryIconName(percentage, charging),
            use_default_fallbacks: false,
        });
        this._icon.fallback_icon_name = iconFallback;

        const formatter = new Intl.NumberFormat(undefined, {style: 'percent'});
        this._label.text = formatter.format(percentage / 100);

        this.visible = isPresent;
    }
}


/**
 * A menu item for devices.
 */
class DeviceMenuItem extends PopupMenu.PopupBaseMenuItem {
    static {
        this[GObject.properties] = {
            'device': GObject.ParamSpec.object('device', null, null,
                GObject.ParamFlags.READWRITE, Remote.Device),
        };
        GObject.registerClass(this);
    }

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

        this._battery = new DeviceBattery({visible: false});
        this.add_child(this._battery);

        this.bind_property('device', this._battery, 'device',
            GObject.BindingFlags.SYNC_CREATE);
        this.device.bind_property('icon-name', this._icon, 'icon-name',
            GObject.BindingFlags.SYNC_CREATE);
        this.device.bind_property('name', this._label, 'text',
            GObject.BindingFlags.SYNC_CREATE);
        device.connectObject('notify::state', this._sync.bind(this), this);

        this._sync(this.device);
    }

    _sync(device, _pspec) {
        this.visible = (device.state & Remote.DeviceState.CONNECTED) !== 0 &&
                       (device.state & Remote.DeviceState.PAIRED) !== 0;
    }
}


/**
 * The quick settings menu for Valent.
 */
class MenuToggle extends QuickSettings.QuickMenuToggle {
    static {
        this[GObject.properties] = {
            'service': GObject.ParamSpec.object('service', null, null,
                GObject.ParamFlags.READWRITE, Remote.Service),
        };
        GObject.registerClass(this);
    }

    constructor(params = {}) {
        super(params);

        this.service.connectObject(
            'notify::active', this._sync.bind(this),
            'items-changed', this._onItemsChanged.bind(this),
            this);

        this.menu.setHeader(_getIcon('active'), _('Devices'));

        // Devices
        this._deviceItems = [];
        this._deviceSection = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._deviceSection);

        // Placeholder
        this._placeholderItem = new PopupMenu.PopupMenuItem('', {
            style_class: 'bt-menu-placeholder',
            reactive: false,
            can_focus: false,
        });
        this._placeholderItem.label.clutter_text.set({
            ellipsize: Pango.EllipsizeMode.NONE,
            line_wrap: true,
        });
        this.menu.addMenuItem(this._placeholderItem);

        this._placeholderItem.bind_property('visible',
            this._deviceSection.actor, 'visible',
            GObject.BindingFlags.SYNC_CREATE |
            GObject.BindingFlags.INVERT_BOOLEAN);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._serviceItem = this.menu.addAction(_('All Devices'),
            this._onServiceActivated.bind(this), '' /* reserve icon */);

        this.connect('destroy', this._onDestroy.bind(this));
        this._sync();
    }

    vfunc_clicked(_clickedButton) {
        const app = Shell.AppSystem.get_default().lookup_app(
            'ca.andyholmes.Valent.desktop');

        if (app === null)
            this.menu.open();
        else if (this.service.active)
            this.service.activate_action('quit');
        else
            this.service.activate();
    }

    _onDestroy(_actor) {
        if (this._installedId)
            Shell.AppSystem.get_default().disconnect(this._installedId);
    }

    _onDeviceActivated(item) {
        Main.overview.hide();
        Main.panel.closeQuickSettings();

        const target = item.device.get_cached_property('Id');
        this.service.activate_action('window', target);
    }

    _onItemsChanged(service, position, removed, added) {
        for (const menuItem of this._deviceItems.splice(position, removed))
            menuItem.destroy();

        for (let i = 0; i < added; i++) {
            const device = service.get_item(position + i);

            const menuItem = new DeviceMenuItem(device);
            menuItem.connectObject(
                'activate', this._onDeviceActivated.bind(this),
                'notify::visible', this._sync.bind(this),
                this);

            this._deviceSection.addMenuItem(menuItem, position + i);
            this._deviceItems.splice(position + i, 0, menuItem);
        }

        this._sync();
    }

    _onInstalledChanged(appSystem) {
        if (appSystem.lookup_app('ca.andyholmes.Valent.desktop') === null)
            return;

        appSystem.disconnect(this._installedId);
        this._installedId = null;
        this._sync();
    }

    _onServiceActivated() {
        const app = Shell.AppSystem.get_default().lookup_app(
            'ca.andyholmes.Valent.desktop');

        if (app === null) {
            const ExtensionMeta = Extension.lookupByUUID('valent@andyholmes.ca');
            Gio.app_info_launch_default_for_uri(ExtensionMeta.metadata.url,
                global.create_app_launch_context(0, -1));
        } else if (this.service.active) {
            const target = GLib.Variant.new_string('main');
            this.service.activate_action('window', target);
        } else {
            this.service.activate();
        }

        Main.overview.hide();
        Main.panel.closeQuickSettings();
    }

    _sync() {
        const app = Shell.AppSystem.get_default().lookup_app(
            'ca.andyholmes.Valent.desktop');

        if (app === null && !this._installedId) {
            this._installedId = Shell.AppSystem.get_default().connect(
                'installed-changed', this._onInstalledChanged.bind(this));
        }

        // Menu Toggle
        const connectedDevices = [...this.service].filter(device => {
            return (device.state & Remote.DeviceState.CONNECTED) !== 0 &&
                   (device.state & Remote.DeviceState.PAIRED) !== 0;
        });
        const nConnected = connectedDevices.length;

        if (nConnected > 1)
            // TRANSLATORS: This is the number of connected devices
            this.subtitle = ngettext('%d Connected', '%d Connected', nConnected).format(nConnected);
        else if (nConnected === 1)
            this.subtitle = connectedDevices[0].name;
        else
            this.subtitle = null;

        this.checked = this.service.active;
        this.gicon = _getIcon(this.service.active ? 'active' : 'inactive');

        // Menu Items
        let placeholderLabel = '';
        let serviceIcon = null;
        let serviceLabel = '';

        if (app === null) {
            placeholderLabel = _('Valent must be installed to connect and sync devices');
            serviceLabel = _('Help');
            serviceIcon = _getIcon('info');
            this._serviceItem.add_style_class_name('valent-help-item');
        } else if (this.service.active) {
            placeholderLabel = _('No available or connected devices');
            serviceLabel = _('All Devices');
            this._serviceItem.remove_style_class_name('valent-help-item');
        } else {
            placeholderLabel = _('Turn on to connect to devices');
            serviceLabel = _('All Devices');
            this._serviceItem.remove_style_class_name('valent-help-item');
        }

        this._placeholderItem.label.text = placeholderLabel;
        this._placeholderItem.visible = !nConnected;
        this._serviceItem.label.text = serviceLabel;
        this._serviceItem.setIcon(serviceIcon);
    }
}


/**
 * The service indicator for Valent.
 */
export class Indicator extends QuickSettings.SystemIndicator {
    static {
        GObject.registerClass(this);
    }

    constructor() {
        super();

        // Service Proxy
        this._service = new Remote.Service();
        this._service.connectObject(
            'items-changed', this._onItemsChanged.bind(this),
            this);

        // Indicator Icon
        this._icon = this._addIndicator();
        this._icon.gicon = _getIcon('active');
        this._icon.visible = false;

        // Service Toggle
        const menuToggle = new MenuToggle({
            service: this._service,
            title: _('Devices'),
        });
        menuToggle.connect('destroy', () => this.quickSettingsItems.pop());
        this.quickSettingsItems.push(menuToggle);

        Main.panel.statusArea.quickSettings.addExternalIndicator(this);
        this.connect('destroy', this._onDestroy.bind(this));
    }

    _onDestroy(_actor) {
        this._service.destroy();
        this.quickSettingsItems.forEach(item => item.destroy());
    }

    _onItemsChanged(service, position, _removed, added) {
        for (let i = 0; i < added; i++) {
            const device = service.get_item(position + i);
            device.connectObject('notify::state', this._sync.bind(this), this);
        }

        this._sync();
    }

    _sync() {
        const connectedDevices = [...this._service].filter(device => {
            return (device.state & Remote.DeviceState.CONNECTED) !== 0 &&
                   (device.state & Remote.DeviceState.PAIRED) !== 0;
        });

        this._icon.visible = connectedDevices.length > 0;
    }
}

