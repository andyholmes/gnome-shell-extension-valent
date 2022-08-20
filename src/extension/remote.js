// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2022 Andy Holmes <andrew.g.r.holmes@gmail.com>

/* exported Service, Device, DeviceState */

const { Gio, GLib, GObject } = imports.gi;

const APPLICATION_ID = 'ca.andyholmes.Valent';
const APPLICATION_PATH = '/ca/andyholmes/Valent';


/**
 * A simple wrapper for Gio.AsyncInitable.init_async().
 *
 * @param {Gio.DBusProxy} proxy - a Gio.DBusProxy
 * @param {Gio.Cancellable} [cancellable] - optional cancellable
 */
function _proxyInit(proxy, cancellable = null) {
    // If this has already been done, propagate the original result
    if (proxy.__initialized === true)
        return Promise.resolve();
    else if (proxy.__initalized !== undefined)
        return Promise.reject(proxy.__initialized);

    return new Promise((resolve, reject) => {
        proxy.init_async(
            GLib.PRIORITY_DEFAULT,
            cancellable,
            (proxy_, res) => {
                try {
                    proxy.init_finish(res);
                    proxy.__initialized = true;

                    resolve();
                } catch (e) {
                    Gio.DBusError.strip_remote_error(e);
                    proxy.__initialized = e;

                    reject(e);
                }
            }
        );
    });
}


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
var Device = GObject.registerClass({
    GTypeName: 'ValentRemoteDevice',
    Implements: [Gio.DBusInterface],
    Properties: {
        'icon-name': GObject.ParamSpec.string(
            'icon-name',
            'Icon Name',
            'A symbolic icon name for the device',
            GObject.ParamFlags.READABLE,
            null
        ),
        'id': GObject.ParamSpec.string(
            'id',
            'ID',
            'A unique ID for the device',
            GObject.ParamFlags.READABLE,
            null
        ),
        'name': GObject.ParamSpec.string(
            'name',
            'Name',
            'A display name for the device',
            GObject.ParamFlags.READABLE,
            null
        ),
        'state': GObject.ParamSpec.uint(
            'state',
            'State',
            'The state of the device',
            GObject.ParamFlags.READABLE,
            DeviceState.NONE, DeviceState.CONNECTED | DeviceState.PAIRED_OUTGOING,
            DeviceState.NONE
        ),
        'type': GObject.ParamSpec.string(
            'type',
            'Type',
            'A string hint, indicating the form-factor of the device',
            GObject.ParamFlags.READABLE,
            null
        ),
    },
}, class Device extends Gio.DBusProxy {
    constructor(params = {}) {
        super(Object.assign({
            g_interface_name: 'ca.andyholmes.Valent.Device',
        }, params));

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
                'Type': 'type',
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

    get type() {
        return this._get('Type', 'desktop');
    }
});


/**
 * A simple proxy wrapper for the GSConnect service.
 */
var Service = GObject.registerClass({
    GTypeName: 'ValentRemoteService',
    Implements: [Gio.DBusInterface],
    Properties: {
        'active': GObject.ParamSpec.boolean(
            'active',
            'Active',
            'Whether the service is active',
            GObject.ParamFlags.READABLE,
            false
        ),
    },
    Signals: {
        'device-added': {
            flags: GObject.SignalFlags.RUN_FIRST,
            param_types: [Device.$gtype],
        },
        'device-removed': {
            flags: GObject.SignalFlags.RUN_FIRST,
            param_types: [Device.$gtype],
        },
    },
}, class Service extends Gio.DBusProxy {
    constructor() {
        super({
            g_bus_type: Gio.BusType.SESSION,
            g_name: APPLICATION_ID,
            g_object_path: APPLICATION_PATH,
            g_interface_name: 'org.freedesktop.DBus.ObjectManager',
            g_flags: Gio.DBusProxyFlags.DO_NOT_AUTO_START_AT_CONSTRUCTION,
        });

        this._cancellable = new Gio.Cancellable();
        this._devices = new Map();
        this._starting = false;

        this._nameOwnerChangedId = this.connect('notify::g-name-owner',
            this._onNameOwnerChanged.bind(this));
    }

    get active() {
        if (this._active === undefined)
            this._active = false;

        return this._active;
    }

    get devices() {
        return Array.from(this._devices.values());
    }

    on_g_signal(senderName_, signalName, parameters) {
        // Ignore signals until the ObjectManager has started
        if (!this.active)
            return;

        const args = parameters.deepUnpack();

        if (signalName === 'InterfacesAdded') {
            this._onInterfacesAdded(...args).catch(e => {
                if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    logError(e, signalName);
            });
        } else if (signalName === 'InterfacesRemoved') {
            this._onInterfacesRemoved(...args);
        }
    }

    /**
     * org.freedesktop.DBus.ObjectManager.InterfacesAdded
     *
     * @param {string} objectPath - Path interfaces have been added to
     * @param {object} interfaces - A dictionary of interface objects
     */
    async _onInterfacesAdded(objectPath, interfaces) {
        // An empty list means only the object has been added
        if (Object.values(interfaces).length === 0)
            return;

        if (this._devices.has(objectPath))
            return;

        const device = new Device({
            g_connection: this.g_connection,
            g_flags: Gio.DBusProxyFlags.DO_NOT_AUTO_START,
            g_name: this.g_name,
            g_object_path: objectPath,
        });
        await _proxyInit(device, this._cancellable);

        this._devices.set(objectPath, device);
        this.emit('device-added', device);
    }

    /**
     * org.freedesktop.DBus.ObjectManager.InterfacesRemoved
     *
     * @param {string} objectPath - Path interfaces have been removed from
     * @param {string[]} interfaces - List of interface names removed
     */
    _onInterfacesRemoved(objectPath, interfaces) {
        // An empty interface list means the object is being removed
        if (interfaces.length === 0)
            return;

        // Ensure this is a managed device
        const device = this._devices.get(objectPath);

        if (device === undefined)
            return;

        this._devices.delete(objectPath);
        this.emit('device-removed', device);
    }

    async _onNameOwnerChanged() {
        try {
            if (this.g_name_owner === null) {
                this._unloadDevices();

                this._active = false;
                this.notify('active');
            } else {
                this._active = true;
                this.notify('active');

                await this._loadDevices();
            }
        } catch (e) {
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                logError(e);
        }
    }

    async _loadDevices() {
        const managedObjects = await new Promise((resolve, reject) => {
            this.call(
                'GetManagedObjects',
                null,
                Gio.DBusCallFlags.NONE,
                -1,
                this._cancellable,
                (proxy, res) => {
                    try {
                        const variant = proxy.call_finish(res);
                        resolve(variant.deepUnpack()[0]);
                    } catch (e) {
                        Gio.DBusError.strip_remote_error(e);
                        reject(e);
                    }
                }
            );
        });

        return Promise.all(Object.entries(managedObjects).map(entry => {
            return this._onInterfacesAdded(...entry);
        }));
    }

    _unloadDevices() {
        for (const [objectPath, device] of this._devices) {
            this._devices.delete(objectPath);
            this.emit('device-removed', device);
        }
    }

    /**
     * Activate a service action.
     *
     * @param {string} name - An action name
     * @param {GLib.Variant} [parameter] - An action parameter
     */
    activate_action(name, parameter = null) {
        const paramArray = [];

        if (parameter instanceof GLib.Variant)
            paramArray[0] = parameter;

        Gio.DBus.session.call(
            APPLICATION_ID,
            APPLICATION_PATH,
            'org.freedesktop.Application',
            'ActivateAction',
            new GLib.Variant('(sava{sv})', [name, paramArray, {}]),
            null,
            Gio.DBusCallFlags.NONE,
            -1,
            this._cancellable,
            (connection, res) => {
                try {
                    connection.call_finish(res);
                } catch (e) {
                    logError(e);
                }
            }
        );
    }

    /**
     * Reload any managed devices, without affecting the the state of the
     * service.
     *
     * This should typically be called after construction to sync with the
     * current state of the service.
     */
    async reload() {
        try {
            if (this._starting === false) {
                this._starting = true;

                this._unloadDevices();
                await _proxyInit(this, this._cancellable);
                await this._onNameOwnerChanged();

                this._starting = false;
            }
        } catch (e) {
            this._starting = false;
            throw e;
        }
    }

    /**
     * Start the service
     */
    async start() {
        try {
            if (this._starting === false && this.active === false) {
                this._starting = true;

                await _proxyInit(this, this._cancellable);
                await this._onNameOwnerChanged();

                // Start the service without emitting GApplication::activate
                if (!this.active) {
                    const reply = await new Promise((resolve, reject) => {
                        this.g_connection.call(
                            'org.freedesktop.DBus',
                            '/org/freedesktop/DBus',
                            'org.freedesktop.DBus',
                            'StartServiceByName',
                            new GLib.Variant('(su)', [APPLICATION_ID, 0]),
                            new GLib.VariantType('(u)'),
                            Gio.DBusCallFlags.NONE,
                            -1,
                            this._cancellable,
                            (proxy, res) => {
                                try {
                                    resolve(proxy.call_finish(res));
                                } catch (e) {
                                    Gio.DBusError.strip_remote_error(e);
                                    reject(e);
                                }
                            }
                        );
                    });

                    // The two expected results are DBUS_START_REPLY_SUCCESS and
                    // DBUS_START_REPLY_ALREADY_RUNNING
                    const [result] = reply.deepUnpack();

                    if (result !== 1 && result !== 2) {
                        throw new Gio.IOErrorEnum({
                            code: Gio.DBusError.FAILED,
                            message: `Unexpected reply: ${result}`,
                        });
                    }
                }

                this._starting = false;
            }
        } catch (e) {
            this._starting = false;
            throw e;
        }
    }

    /**
     * Stop the service
     */
    stop() {
        if (this.active)
            this.activate_action('quit');
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
            this._active = false;
        }
    }
});

