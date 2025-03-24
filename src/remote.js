// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: Andy Holmes <andrew.g.r.holmes@gmail.com>

import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';

const APPLICATION_ID = 'ca.andyholmes.Valent';
const APPLICATION_PATH = '/ca/andyholmes/Valent';


/**
 * Device state flags.
 *
 * @readonly
 * @enum {number}
 */
export const DeviceState = Object.freeze({
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
 * A D-Bus proxy for a device.
 */
export class Device extends Gio.DBusProxy {
    static {
        this[GObject.interfaces] = [Gio.DBusInterface];
        this[GObject.properties] = {
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
            console.error(e);
        }
    }

    #get(name, fallback = null) {
        const value = this.get_cached_property(name);

        if (value instanceof GLib.Variant)
            return value.unpack();

        return fallback;
    }

    get icon_name() {
        return this.#get('IconName', 'computer-symbolic');
    }

    get id() {
        return this.#get('Id', null);
    }

    get name() {
        return this.#get('Name', null);
    }

    get state() {
        return this.#get('State', DeviceState.NONE);
    }
}


/**
 * A D-Bus proxy for the service.
 */
export class Service extends Gio.DBusProxy {
    static {
        this[GObject.interfaces] = [Gio.DBusInterface, Gio.ListModel];
        this[GObject.properties] = {
            'active': GObject.ParamSpec.boolean('active', null, null,
                GObject.ParamFlags.READABLE, false),
        };
        GObject.registerClass(this);
    }

    #activating;
    #active;
    #cancellable;
    #items;
    #nameOwnerChangedId;

    constructor() {
        super({
            g_bus_type: Gio.BusType.SESSION,
            g_name: APPLICATION_ID,
            g_object_path: APPLICATION_PATH,
            g_interface_name: 'org.freedesktop.DBus.ObjectManager',
            g_flags: Gio.DBusProxyFlags.DO_NOT_AUTO_START_AT_CONSTRUCTION |
                Gio.DBusProxyFlags.DO_NOT_LOAD_PROPERTIES,
        });

        this.#activating = false;
        this.#cancellable = new Gio.Cancellable();
        this.#items = [];

        this.init_async(GLib.PRIORITY_DEFAULT, this.#cancellable,
            this.#initCallback.bind(this));
    }

    get active() {
        if (this.#active === undefined)
            this.#active = false;

        return this.#active;
    }

    on_g_signal(senderName_, signalName, parameters) {
        const args = parameters.deepUnpack();

        if (signalName === 'InterfacesAdded')
            this.#onInterfacesAdded(...args);
        else if (signalName === 'InterfacesRemoved')
            this.#onInterfacesRemoved(...args);
    }

    vfunc_get_item(position) {
        return this.#items[position] || null;
    }

    vfunc_get_item_type() {
        return Device.$gtype;
    }

    vfunc_get_n_items() {
        return this.#items.length;
    }

    *[Symbol.iterator]() {
        for (const item of this.#items)
            yield item;
    }

    #initCallback(service, result) {
        try {
            service.init_finish(result);

            this.#nameOwnerChangedId = this.connect('notify::g-name-owner',
                this.#onNameOwnerChanged.bind(this));
            this.#onNameOwnerChanged();
        } catch (e) {
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                console.warn(e);
        }
    }

    #deviceInitCallback(device, result) {
        try {
            device.init_finish(result);

            if (this.#items.some(item => item.id === device.id))
                return;

            const position = this.#items.length;
            this.#items.push(device);
            this.items_changed(position, 0, 1);
        } catch (e) {
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                console.warn(e);
        }
    }

    #onInterfacesAdded(objectPath, interfaces) {
        // An empty list means only the object has been added
        if (Object.values(interfaces).length === 0)
            return;

        const device = new Device({
            g_connection: this.g_connection,
            g_name: this.g_name,
            g_object_path: objectPath,
        });

        device.init_async(GLib.PRIORITY_DEFAULT, this.#cancellable,
            this.#deviceInitCallback.bind(this));
    }

    #onInterfacesRemoved(objectPath, _interfaces) {
        const position = this.#items.findIndex(
            item => item.g_object_path === objectPath);

        if (position === -1)
            return;

        this.#items.splice(position, 1);
        this.items_changed(position, 1, 0);
    }

    #onNameOwnerChanged() {
        if (this.g_name_owner === null) {
            this.#unloadDevices();

            this.#active = false;
            this.notify('active');
        } else {
            this.#active = true;
            this.notify('active');

            this.#loadDevices();
        }
    }

    #loadDevices() {
        this.call(
            'GetManagedObjects',
            null,
            Gio.DBusCallFlags.DO_NOT_AUTO_START,
            -1,
            this.#cancellable,
            (proxy, res) => {
                try {
                    const variant = proxy.call_finish(res);
                    const [managedObjects] = variant.deepUnpack();

                    Object.entries(managedObjects).forEach(entry => {
                        this.#onInterfacesAdded(...entry);
                    });
                } catch (e) {
                    if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        console.warn(e);
                }
            }
        );
    }

    #unloadDevices() {
        const removed = this.#items.length;
        this.#items.length = 0;
        this.items_changed(0, removed, 0);
    }

    /**
     * Activate the service.
     *
     * This avoids `org.freedesktop.Application.Activate()`, which would result
     * in a `GApplication::activate` emission opening the main window.
     */
    activate() {
        if (this.#activating || this.active)
            return;

        this.#activating = true;
        Gio.DBus.session.call(
            'org.freedesktop.DBus',
            '/org/freedesktop/DBus',
            'org.freedesktop.DBus',
            'StartServiceByName',
            new GLib.Variant('(su)', [APPLICATION_ID, 0]),
            new GLib.VariantType('(u)'),
            Gio.DBusCallFlags.NONE,
            -1,
            this.#cancellable,
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
                        console.warn(e);
                } finally {
                    this.#activating = false;
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
            this.#cancellable,
            (connection, res) => {
                try {
                    connection.call_finish(res);
                } catch (e) {
                    if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        console.warn(e);
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
            this.#cancellable,
            (connection, res) => {
                try {
                    connection.call_finish(res);
                } catch (e) {
                    if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        console.warn(e);
                }
            }
        );
    }

    /**
     * Disconnect from the D-Bus service, without affecting its state.
     */
    destroy() {
        if (!this.#cancellable.is_cancelled()) {
            this.#cancellable.cancel();

            this.disconnect(this.#nameOwnerChangedId);
            this.#nameOwnerChangedId = 0;

            this.#unloadDevices();
            this.#activating = true;
            this.#active = false;
        }
    }
}

