// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2022 Andy Holmes <andrew.g.r.holmes@gmail.com>
// SPDX-FileContributor: Gavin Luo <lunt.luo@gmail.com>

/* exported Clipboard */

const ByteArray = imports.byteArray;
const { GLib, GjsPrivate, Gio, GObject, Meta } = imports.gi;


/*
 * DBus Interface Info
 */
const DBUS_NAME = 'org.gnome.Shell.Extensions.Valent.Clipboard';
const DBUS_PATH = '/org/gnome/Shell/Extensions/Valent/Clipboard';
const DBUS_INFO = Gio.DBusInterfaceInfo.new_for_xml(`
<node>
  <interface name="org.gnome.Shell.Extensions.Valent.Clipboard">
    <!-- Methods -->
    <method name="GetMimetypes">
      <arg direction="out" type="as" name="mimetypes"/>
    </method>
    <method name="GetText">
      <arg direction="out" type="s" name="text"/>
    </method>
    <method name="SetText">
      <arg direction="in" type="s" name="text"/>
    </method>
    <method name="GetValue">
      <arg direction="in" type="s" name="mimetype"/>
      <arg direction="out" type="ay" name="value"/>
    </method>
    <method name="SetValue">
      <arg direction="in" type="ay" name="value"/>
      <arg direction="in" type="s" name="mimetype"/>
    </method>

    <!-- Signals -->
    <signal name="Changed"/>
  </interface>
</node>
`);


/*
 * Text Mimetypes
 */
const TEXT_MIMETYPES = [
    'text/plain;charset=utf-8',
    'UTF8_STRING',
    'text/plain',
    'STRING',
];


/**
 * ValentClipboard:
 *
 * A simple clipboard portal, especially useful on Wayland where GdkClipboard
 * doesn't work in the background.
 */
var Clipboard = GObject.registerClass({
    GTypeName: 'ValentClipboard',
}, class ValentClipboard extends GjsPrivate.DBusImplementation {
    _init() {
        super._init({
            g_interface_info: DBUS_INFO,
        });

        this._selection = global.display.get_selection();
        this._serviceOwner = null;
        this._transferring = false;

        // Watch the service
        this._nameWatcherId = Gio.DBus.watch_name(
            Gio.BusType.SESSION,
            'ca.andyholmes.Valent',
            Gio.BusNameWatcherFlags.NONE,
            this._onNameAppeared.bind(this),
            this._onNameVanished.bind(this)
        );
    }

    _onChanged(selection, type, _source) {
        /* We're only interested in the standard clipboard */
        if (type !== Meta.SelectionType.SELECTION_CLIPBOARD)
            return;

        /* In Wayland an intermediate GMemoryOutputStream is used which triggers
         * a second ::owner-changed emission, so we need to ensure we ignore
         * that while the transfer is resolving.
         */
        if (this._transferring)
            return;

        this._transferring = true;

        /* We need to put our signal emission in an idle callback to ensure that
         * Mutter's internal calls have finished resolving in the loop, or else
         * we'll end up with the previous selection's content.
         */
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this.emit_signal('Changed', null);
            this._transferring = false;

            return GLib.SOURCE_REMOVE;
        });
    }

    async _onHandleMethodCall(iface, name, parameters, invocation) {
        let retval;

        // Restrict access to the ca.andyholmes.Valent name owner
        const message = invocation.get_message();

        if (message.get_sender() !== this._serviceOwner) {
            invocation.return_error_literal(Gio.DBusError.quark(),
                Gio.DBusError.ACCESS_DENIED, 'Clipboard access refused');

            return;
        }

        try {
            const args = parameters.recursiveUnpack();

            retval = await this[name](...args);
        } catch (e) {
            if (e instanceof GLib.Error) {
                invocation.return_gerror(e);
            } else {
                if (!e.name.includes('.'))
                    e.name = `org.gnome.gjs.JSError.${e.name}`;

                invocation.return_dbus_error(e.name, e.message);
            }

            return;
        }

        if (retval === undefined)
            retval = new GLib.Variant('()', []);

        try {
            if (!(retval instanceof GLib.Variant)) {
                const args = DBUS_INFO.lookup_method(name).out_args;
                retval = new GLib.Variant(
                    `(${args.map(arg => arg.signature).join('')})`,
                    args.length === 1 ? [retval] : retval
                );
            }

            invocation.return_value(retval);
        } catch (e) {
            invocation.return_error_literal(Gio.DBusError.quark(),
                Gio.DBusError.FAILED, e.message);
        }
    }

    _onNameAppeared(_connection, _name, nameOwner) {
        this._serviceOwner = nameOwner;

        this._nameOwnerId = Gio.DBus.own_name(
            Gio.BusType.SESSION,
            DBUS_NAME,
            Gio.BusNameOwnerFlags.NONE,
            this._onBusAcquired.bind(this),
            null,
            this._onNameLost.bind(this)
        );
    }

    _onNameVanished(_connection, _name) {
        this._serviceOwner = null;

        if (this._nameOwnerId) {
            Gio.bus_unown_name(this._nameOwnerId);
            this._nameOwnerId = 0;

            // NOTE: _onNameLost() isn't invoked when we manually unown the name
            this._onNameLost();
        }
    }

    _onBusAcquired(connection, _name) {
        try {
            this._ownerChangedId = this._selection.connect('owner-changed',
                this._onChanged.bind(this));

            this._handleMethodCallId = this.connect('handle-method-call',
                this._onHandleMethodCall.bind(this));

            this.export(connection, DBUS_PATH);
        } catch (e) {
            logError(e);
        }
    }

    _onNameLost(_connection, _name) {
        try {
            this.unexport();

            if (this._handleMethodCallId) {
                this.disconnect(this._handleMethodCallId);
                this._handleMethodCallId = 0;
            }

            if (this._ownerChangedId) {
                this._selection.disconnect(this._ownerChangedId);
                this._ownerChangedId = 0;
            }
        } catch (e) {
            logError(e);
        }
    }

    /**
     * Get the available mimetypes of the current clipboard content
     *
     * @returns {Promise<string[]>} - A list of mime-types
     */
    GetMimetypes() {
        return new Promise((resolve, reject) => {
            try {
                const mimetypes = this._selection.get_mimetypes(
                    Meta.SelectionType.SELECTION_CLIPBOARD);

                resolve(mimetypes);
            } catch (e) {
                reject(e);
            }
        });
    }

    /**
     * Get the text content of the clipboard
     *
     * @returns {Promise<string>} - Text content of the clipboard
     */
    GetText() {
        return new Promise((resolve, reject) => {
            const mimetypes = this._selection.get_mimetypes(
                Meta.SelectionType.SELECTION_CLIPBOARD);

            const mimetype = TEXT_MIMETYPES.find(type => mimetypes.includes(type));

            if (mimetype !== undefined) {
                const stream = Gio.MemoryOutputStream.new_resizable();

                this._selection.transfer_async(
                    Meta.SelectionType.SELECTION_CLIPBOARD,
                    mimetype, -1,
                    stream, null,
                    (selection, res) => {
                        try {
                            selection.transfer_finish(res);

                            const bytes = stream.steal_as_bytes();
                            const bytearray = bytes.get_data();

                            resolve(ByteArray.toString(bytearray));
                        } catch (e) {
                            reject(e);
                        }
                    }
                );
            } else {
                reject(new Error('text not available'));
            }
        });
    }

    /**
     * Set the text content of the clipboard
     *
     * @param {string} text - text content to set
     * @returns {Promise} - A promise for the operation
     */
    SetText(text) {
        return new Promise((resolve, reject) => {
            try {
                if (typeof text !== 'string') {
                    throw new Gio.DBusError({
                        code: Gio.DBusError.INVALID_ARGS,
                        message: 'expected string',
                    });
                }

                const source = Meta.SelectionSourceMemory.new(
                    'text/plain;charset=utf-8', GLib.Bytes.new(text));

                this._selection.set_owner(
                    Meta.SelectionType.SELECTION_CLIPBOARD, source);

                resolve();
            } catch (e) {
                reject(e);
            }
        });
    }

    /**
     * Get the content of the clipboard with the type @mimetype.
     *
     * @param {string} mimetype - the mimetype to request
     * @returns {Promise<Uint8Array>} - The content of the clipboard
     */
    GetValue(mimetype) {
        return new Promise((resolve, reject) => {
            const stream = Gio.MemoryOutputStream.new_resizable();

            this._selection.transfer_async(
                Meta.SelectionType.SELECTION_CLIPBOARD,
                mimetype, -1,
                stream, null,
                (selection, res) => {
                    try {
                        selection.transfer_finish(res);

                        const bytes = stream.steal_as_bytes();

                        resolve(bytes.get_data());
                    } catch (e) {
                        reject(e);
                    }
                }
            );
        });
    }

    /**
     * Set the content of the clipboard to @value with the type @mimetype.
     *
     * @param {Uint8Array} value - the value to set
     * @param {string} mimetype - the mimetype of the value
     * @returns {Promise} - A promise for the operation
     */
    SetValue(value, mimetype) {
        return new Promise((resolve, reject) => {
            try {
                const source = Meta.SelectionSourceMemory.new(mimetype,
                    GLib.Bytes.new(value));

                this._selection.set_owner(
                    Meta.SelectionType.SELECTION_CLIPBOARD, source);

                resolve();
            } catch (e) {
                reject(e);
            }
        });
    }

    destroy() {
        if (this._nameWatcherId) {
            Gio.bus_unwatch_name(this._nameWatcherId);
            this._nameWatcherId = 0;
        }

        if (this._nameOwnerId) {
            Gio.bus_unown_name(this._nameOwnerId);
            this._nameOwnerId = 0;

            // NOTE: _onNameLost() isn't invoked when we manually unown the name
            this._onNameLost();
        }
    }
});

