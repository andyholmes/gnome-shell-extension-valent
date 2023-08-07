// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: Andy Holmes <andrew.g.r.holmes@gmail.com>

/* exported Service, Device, DeviceState */

const {Gio, GLib, GObject} = imports.gi;

const APPLICATION_ID = 'ca.andyholmes.Valent';
const APPLICATION_PATH = '/ca/andyholmes/Valent';


/**
 * Device state flags.
 *
 * @readonly
 * @enum {number}
 */
var DeviceState = Object.freeze({
    /** Device unpaired and disconnected */
    NONE: 0,
    /** Device is connected */
    CONNECTED: 1,
    /** Device is paired */
    PAIRED: 2,
    /** Pair request received from device */
    PAIR_INCOMING: 4,
    /** Pair request sent to device */
    PAIR_OUTGOING: 8,
});


/**
 * A simple proxy wrapper for devices exported over DBus.
 */
var Device = class Device extends Gio.DBusProxy {
    static [GObject.interfaces] = [Gio.DBusInterface];
    static [GObject.properties] = {
        'icon-name': GObject.ParamSpec.string('icon-name', null, null,
            GObject.ParamFlags.READABLE, null),
        'id': GObject.ParamSpec.string('id', null, null,
            GObject.ParamFlags.READABLE, null),
        'name': GObject.ParamSpec.string('name', null, null,
            GObject.ParamFlags.READABLE, null),
        'state': GObject.ParamSpec.uint('state', null, null,
            GObject.ParamFlags.READABLE,
            DeviceState.NONE, DeviceState.CONNECTED | DeviceState.PAIRED_OUTGOING,
            DeviceState.NONE),
    };

    static {
        GObject.registerClass(this);
    }

    constructor(params = {}) {
        super({
            g_interface_name: 'ca.andyholmes.Valent.Device',
            g_flags: Gio.DBusProxyFlags.DO_NOT_AUTO_START |
                Gio.DBusProxyFlags.DO_NOT_CONNECT_SIGNALS,
            ...params,
        });

        this.action_group = Gio.DBusActionGroup.get(this.g_connection,
            this.g_name, this.g_object_path);
    }

    on_g_properties_changed(changed, _invalidated) {
        try {
            const properties = {
                'IconName': 'icon-name',
                'Id': 'id',
                'Name': 'name',
                'State': 'state',
            };

            for (const name in changed.deepUnpack())
                this.notify(properties[name]);
        } catch (e) {
            logError(e);
        }
    }

    _get(name, fallback = null) {
        const value = this.get_cached_property(name);

        if (value instanceof GLib.Variant)
            return value.unpack();

        return fallback;
    }

    get icon_name() {
        return this._get('IconName', 'computer-symbolic');
    }

    get id() {
        return this._get('Id', null);
    }

    get name() {
        return this._get('Name', null);
    }

    get state() {
        return this._get('State', DeviceState.NONE);
    }
};


/**
 * A simple proxy wrapper for the GSConnect service.
 */
var Service = class Service extends Gio.DBusProxy {
    static [GObject.interfaces] = [Gio.DBusInterface, Gio.ListModel];
    static [GObject.properties] = {
        'active': GObject.ParamSpec.boolean('active', null, null,
            GObject.ParamFlags.READABLE, false),
    };

    static {
        GObject.registerClass(this);
    }

    constructor() {
        super({
            g_bus_type: Gio.BusType.SESSION,
            g_name: APPLICATION_ID,
            g_object_path: APPLICATION_PATH,
            g_interface_name: 'org.freedesktop.DBus.ObjectManager',
            g_flags: Gio.DBusProxyFlags.DO_NOT_AUTO_START_AT_CONSTRUCTION |
                Gio.DBusProxyFlags.DO_NOT_LOAD_PROPERTIES,
        });

        this._activating = false;
        this._cancellable = new Gio.Cancellable();
        this._items = [];

        this.init_async(GLib.PRIORITY_DEFAULT, this._cancellable,
            this._initCallback.bind(this));
    }

    get active() {
        if (this._active === undefined)
            this._active = false;

        return this._active;
    }

    on_g_signal(senderName_, signalName, parameters) {
        const args = parameters.deepUnpack();

        if (signalName === 'InterfacesAdded')
            this._onInterfacesAdded(...args);
        else if (signalName === 'InterfacesRemoved')
            this._onInterfacesRemoved(...args);
    }

    vfunc_get_item(position) {
        return this._items[position] || null;
    }

    vfunc_get_item_type() {
        return Device.$gtype;
    }

    vfunc_get_n_items() {
        return this._items.length;
    }

    *[Symbol.iterator]() {
        for (const item of this._items)
            yield item;
    }

    _initCallback(service, result) {
        try {
            service.init_finish(result);

            this._nameOwnerChangedId = this.connect('notify::g-name-owner',
                this._onNameOwnerChanged.bind(this));
            this._onNameOwnerChanged();
        } catch (e) {
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                logError(e);
        }
    }

    _deviceInitCallback(device, result) {
        try {
            device.init_finish(result);

            if (this._items.some(item => item.id === device.id))
                return;

            const position = this._items.length;
            this._items.push(device);
            this.items_changed(position, 0, 1);
        } catch (e) {
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                logError(e, device.g_object_path);
        }
    }

    _onInterfacesAdded(objectPath, interfaces) {
        // An empty list means only the object has been added
        if (Object.values(interfaces).length === 0)
            return;

        const device = new Device({
            g_connection: this.g_connection,
            g_name: this.g_name,
            g_object_path: objectPath,
        });

        device.init_async(GLib.PRIORITY_DEFAULT, this._cancellable,
            this._deviceInitCallback.bind(this));
    }

    _onInterfacesRemoved(objectPath, _interfaces) {
        const position = this._items.findIndex(
            item => item.g_object_path === objectPath);

        if (position === -1)
            return;

        this._items.splice(position, 1);
        this.items_changed(position, 1, 0);
    }

    _onNameOwnerChanged() {
        if (this.g_name_owner === null) {
            this._unloadDevices();

            this._active = false;
            this.notify('active');
        } else {
            this._active = true;
            this.notify('active');

            this._loadDevices();
        }
    }

    _loadDevices() {
        this.call(
            'GetManagedObjects',
            null,
            Gio.DBusCallFlags.DO_NOT_AUTO_START,
            -1,
            this._cancellable,
            (proxy, res) => {
                try {
                    const variant = proxy.call_finish(res);
                    const [managedObjects] = variant.deepUnpack();

                    Object.entries(managedObjects).forEach(entry => {
                        this._onInterfacesAdded(...entry);
                    });
                } catch (e) {
                    if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        logError(e);
                }
            }
        );
    }

    _unloadDevices() {
        const removed = this._items.length;
        this._items.length = 0;
        this.items_changed(0, removed, 0);
    }

    /**
     * Activate the service.
     *
     * This avoids `org.freedesktop.Application.Activate()`, which would result
     * in a `GApplication::activate` emission opening the main window.
     */
    activate() {
        if (this._activating || this.active)
            return;

        this._activating = true;
        Gio.DBus.session.call(
            'org.freedesktop.DBus',
            '/org/freedesktop/DBus',
            'org.freedesktop.DBus',
            'StartServiceByName',
            new GLib.Variant('(su)', [APPLICATION_ID, 0]),
            new GLib.VariantType('(u)'),
            Gio.DBusCallFlags.NONE,
            -1,
            this._cancellable,
            (connection, res) => {
                try {
                    const reply = connection.call_finish(res);
                    const [result] = reply.deepUnpack();

                    // The two expected results are DBUS_START_REPLY_SUCCESS
                    // and DBUS_START_REPLY_ALREADY_RUNNING, respectively
                    if (result !== 1 && result !== 2) {
                        throw new Gio.IOErrorEnum({
                            code: Gio.DBusError.FAILED,
                            message: `Unexpected reply: ${result}`,
                        });
                    }
                } catch (e) {
                    if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        logError(e);
                } finally {
                    this._activating = false;
                }
            }
        );
    }

    /**
     * Activate a service action.
     *
     * @param {string} name - An action name
     * @param {GLib.Variant} [target] - An action target
     */
    activate_action(name, target = null) {
        const parameters = [];

        if (target instanceof GLib.Variant)
            parameters[0] = target;

        Gio.DBus.session.call(
            APPLICATION_ID,
            APPLICATION_PATH,
            'org.freedesktop.Application',
            'ActivateAction',
            new GLib.Variant('(sava{sv})', [name, parameters, {}]),
            null,
            Gio.DBusCallFlags.NONE,
            -1,
            this._cancellable,
            (connection, res) => {
                try {
                    connection.call_finish(res);
                } catch (e) {
                    if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        logError(e);
                }
            }
        );
    }

    /**
     * Activate the service with files to open.
     *
     * @param {string[]} uris - A list of URIs to open
     */
    open(uris = []) {
        Gio.DBus.session.call(
            APPLICATION_ID,
            APPLICATION_PATH,
            'org.freedesktop.Application',
            'Open',
            new GLib.Variant('(asa{sv})', [uris, {}]),
            null,
            Gio.DBusCallFlags.NONE,
            -1,
            this._cancellable,
            (connection, res) => {
                try {
                    connection.call_finish(res);
                } catch (e) {
                    if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        logError(e);
                }
            }
        );
    }

    /**
     * Disconnect from the D-Bus service, without affecting its state.
     */
    destroy() {
        if (!this._cancellable.is_cancelled()) {
            this._cancellable.cancel();

            this.disconnect(this._nameOwnerChangedId);
            this._nameOwnerChangedId = 0;

            this._unloadDevices();
            this._activating = true;
            this._active = false;
        }
    }
};

