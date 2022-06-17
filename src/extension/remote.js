// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2022 Andy Holmes <andrew.g.r.holmes@gmail.com>

/* exported Service, Device, DeviceState */

const { Gio, GLib, GObject } = imports.gi;

const SERVICE_NAME = 'ca.andyholmes.Valent';
const SERVICE_PATH = '/ca/andyholmes/Valent';


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
        'connected': GObject.ParamSpec.boolean(
            'connected',
            'Connected',
            'Whether the device is connected',
            GObject.ParamFlags.READABLE,
            false
        ),
        'icon-name': GObject.ParamSpec.string(
            'icon-name',
            'Icon Name',
            'Icon name representing the device',
            GObject.ParamFlags.READABLE,
            null
        ),
        'id': GObject.ParamSpec.string(
            'id',
            'ID',
            'The unique ID of the device',
            GObject.ParamFlags.READABLE,
            ''
        ),
        'name': GObject.ParamSpec.string(
            'name',
            'Name',
            'The device name',
            GObject.ParamFlags.READABLE,
            null
        ),
        'paired': GObject.ParamSpec.boolean(
            'paired',
            'Paired',
            'Whether the device is paired',
            GObject.ParamFlags.READABLE,
            false
        ),
        'state': GObject.ParamSpec.int64(
            'state',
            'State',
            'The state of the device.',
            GObject.ParamFlags.READABLE,
            DeviceState.NONE, DeviceState.CONNECTED | DeviceState.PAIRED_OUTGOING,
            DeviceState.NONE
        ),
        'type': GObject.ParamSpec.string(
            'type',
            'Type',
            'The device type',
            GObject.ParamFlags.READABLE,
            null
        ),
    },
}, class Device extends Gio.DBusProxy {
    constructor(service, objectPath) {
        super({
            g_connection: service.g_connection,
            g_name: SERVICE_NAME,
            g_object_path: objectPath,
            g_interface_name: 'ca.andyholmes.Valent.Device',
        });
    }

    on_g_properties_changed(changed, _invalidated) {
        try {
            const properties = {
                'Connected': 'connected',
                'IconName': 'icon-name',
                'Id': 'id',
                'Name': 'name',
                'Paired': 'paired',
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

    get connected() {
        return this._get('Connected', false);
    }

    get icon_name() {
        return this._get('IconName', 'computer');
    }

    get id() {
        return this._get('Id', '0');
    }

    get name() {
        return this._get('Name', 'Unknown');
    }

    get paired() {
        return this._get('Paired', false);
    }

    get state() {
        return this._get('State', DeviceState.NONE);
    }

    get type() {
        return this._get('Type', 'desktop');
    }

    async start(cancellable = null) {
        await _proxyInit(this, cancellable);

        this.action_group = Gio.DBusActionGroup.get(this.g_connection,
            this.g_name_owner, this.g_object_path);
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
            g_name: SERVICE_NAME,
            g_object_path: SERVICE_PATH,
            g_interface_name: 'org.freedesktop.DBus.ObjectManager',
            g_flags: Gio.DBusProxyFlags.DO_NOT_AUTO_START_AT_CONSTRUCTION,
        });

        this._cancellable = new Gio.Cancellable();
        this._devices = new Map();
        this._starting = false;

        this._interfacesChangedId = this.connect('g-signal',
            this._onInterfacesChanged.bind(this));
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

    _onInterfacesChanged(proxy_, senderName_, signalName, parameters) {
        try {
            // Ignore signals until the ObjectManager has started
            if (!this.active)
                return;

            const args = parameters.deepUnpack();

            if (signalName === 'InterfacesAdded')
                this._onInterfacesAdded(...args);
            else if (signalName === 'InterfacesRemoved')
                this._onInterfacesRemoved(...args);
        } catch (e) {
            logError(e);
        }
    }

    /**
     * org.freedesktop.DBus.ObjectManager.InterfacesAdded
     *
     * @param {string} objectPath - Path interfaces have been added to
     * @param {object} interfaces - A dictionary of interface objects
     */
    async _onInterfacesAdded(objectPath, interfaces) {
        try {
            // An empty list means only the object has been added
            if (Object.values(interfaces).length === 0)
                return;

            if (this._devices.has(objectPath))
                return;

            // Create a proxy for the device
            const device = new Device(this, objectPath);
            await device.start(this._cancellable);

            this._devices.set(objectPath, device);
            this.emit('device-added', device);
        } catch (e) {
            logError(e, objectPath);
        }
    }

    /**
     * org.freedesktop.DBus.ObjectManager.InterfacesRemoved
     *
     * @param {string} objectPath - Path interfaces have been removed from
     * @param {string[]} interfaces - List of interface names removed
     */
    _onInterfacesRemoved(objectPath, interfaces) {
        try {
            // An empty interface list means the object is being removed
            if (interfaces.length === 0)
                return;

            // Ensure this is a managed device
            const device = this._devices.get(objectPath);

            if (device === undefined)
                return;

            this._devices.delete(objectPath);
            this.emit('device-removed', device);
        } catch (e) {
            logError(e, objectPath);
        }
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
            if (!e.matches(Gio.IO_ERROR, Gio.IO_ERROR_CANCELLED))
                logError(e);
        }
    }

    async _loadDevices() {
        const objects = await new Promise((resolve, reject) => {
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

        // We await in a loop to avoid weird race conditions
        for (const [objectPath, object] of Object.entries(objects))
            // eslint-disable-next-line no-await-in-loop
            await this._onInterfacesAdded(objectPath, object);
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
        try {
            const paramArray = [];

            if (parameter instanceof GLib.Variant)
                paramArray[0] = parameter;

            Gio.DBus.session.call(
                SERVICE_NAME,
                SERVICE_PATH,
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
        } catch (e) {
            if (!e.matches(Gio.IO_ERROR, Gio.IO_ERROR_CANCELLED))
                logError(e);
        }
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
                await _proxyInit(this);
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
                            new GLib.Variant('(su)', [SERVICE_NAME, 0]),
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

            this.disconnect(this._interfacesChangedId);
            this._interfacesChangedId = 0;

            this.disconnect(this._nameOwnerChangedId);
            this._nameOwnerChangedId = 0;

            this._unloadDevices();
            this._active = false;
        }
    }
});

