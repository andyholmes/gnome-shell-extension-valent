// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2022 Andy Holmes <andrew.g.r.holmes@gmail.com>

/* exported patchNotificationSources, unpatchNotificationSources */

const { Gio, GLib, GObject, St } = imports.gi;

const Main = imports.ui.main;
const MessageTray = imports.ui.messageTray;
const NotificationDaemon = imports.ui.notificationDaemon;

const ExtensionUtils = imports.misc.extensionUtils;
const _ = ExtensionUtils.gettext;

const APP_ID = 'ca.andyholmes.Valent';
const APP_PATH = '/ca/andyholmes/Valent';
const DEVICE_REGEX = new RegExp(/^(.+?)::(.+)$/);

// Overridden methods
const _addNotification = NotificationDaemon.GtkNotificationDaemonAppSource.prototype.addNotification;
const _createBanner = NotificationDaemon.GtkNotificationDaemonAppSource.prototype.createBanner;
const _pushNotification = NotificationDaemon.GtkNotificationDaemonAppSource.prototype.pushNotification;


/**
 * A slightly modified Notification Banner with an entry field
 */
const NotificationBanner = GObject.registerClass({
    GTypeName: 'ValentNotificationBanner',
}, class NotificationBanner extends MessageTray.NotificationBanner {
    _init(notification) {
        super._init(notification);

        if (this.notification._defaultAction === 'app.device') {
            const [
                deviceId_,
                deviceActionName,
                [deviceActionTarget_],
            ] = this.notification._defaultActionTarget.deepUnpack();

            if (deviceActionName === 'notification.reply')
                this._addReplyAction();
        }
    }

    _addReplyAction() {
        if (!this._buttonBox) {
            this._buttonBox = new St.BoxLayout({
                style_class: 'notification-actions',
                x_expand: true,
            });
            this.setActionArea(this._buttonBox);
            global.focus_manager.add_group(this._buttonBox);
        }

        const button = new St.Button({
            style_class: 'notification-button',
            // TRANSLATORS: A notification button to show the quick-reply entry
            label: _('Reply'),
            x_expand: true,
            can_focus: true,
        });
        button.connect('clicked', this._onEntryRequested.bind(this));
        this._buttonBox.add_child(button);

        this._replyEntry = new St.Entry({
            can_focus: true,
            // TRANSLATORS: A reply entry in a notification
            hint_text: _('Type a message'),
            style_class: 'chat-response',
            x_expand: true,
            visible: false,
        });
        this._buttonBox.add_child(this._replyEntry);

        // This notification banner is for a repliable notification, so we
        // prevent the notification from being dismissed when activated.
        if (this.notification._activatedId) {
            this.notification.disconnect(this.notification._activatedId);
            this.notification._activatedId = this.notification.connect_after(
                'activated',
                notification => {
                    notification.destroy(MessageTray.NotificationDestroyedReason.EXPIRED);
                }
            );
        }
    }

    _onEntryRequested(_button) {
        this.focused = true;

        for (const child of this._buttonBox.get_children())
            child.visible = child === this._replyEntry;

        // Release the notification focus with the entry focus
        this._replyEntry.connect('key-focus-out',
            this._onEntryDismissed.bind(this));

        this._replyEntry.clutter_text.connect('activate',
            this._onEntryActivated.bind(this));

        this._replyEntry.grab_key_focus();
    }

    _onEntryDismissed(_entry) {
        this.focused = false;
        this.emit('unfocused');
    }

    _onEntryActivated(clutterText) {
        // Refuse to send empty replies
        if (clutterText.get_text() === '')
            return;

        const [
            deviceId,
            deviceActionName,
            [deviceActionTarget],
        ] = this.notification._defaultActionTarget.deepUnpack();

        const [
            replyId,
            replyMessage_,
            replyNotification,
        ] = deviceActionTarget.deepUnpack();

        // Copy the text, then clear the entry
        const replyMessage = clutterText.get_text();
        clutterText.set_text('');

        const target = new GLib.Variant('(ssav)', [
            deviceId,
            deviceActionName,
            [new GLib.Variant('(ssv)', [replyId, replyMessage, replyNotification])],
        ]);
        const platformData = NotificationDaemon.getPlatformData();

        Gio.DBus.session.call(
            APP_ID,
            APP_PATH,
            'org.freedesktop.Application',
            'ActivateAction',
            new GLib.Variant('(sava{sv})', ['device', [target], platformData]),
            null,
            Gio.DBusCallFlags.NO_AUTO_START,
            -1,
            null,
            (connection, res) => {
                try {
                    connection.call_finish(res);
                } catch {
                    // Silence errors
                }
            }
        );

        // We want the notification banner to disappear, but we don't want
        // close() to be invoked, because that will result in the notification
        // being destroyed.
        this._closed = true;
        this.destroy();
    }
});


/**
 * A custom notification source for spawning notifications and closing device
 * notifications. This source is never instantiated; it's methods are patched
 * into existing sources.
 */
const Source = GObject.registerClass({
    GTypeName: 'ValentNotificationSource',
}, class Source extends NotificationDaemon.GtkNotificationDaemonAppSource {
    _valentCloseNotification(notification, reason) {
        if (reason !== MessageTray.NotificationDestroyedReason.DISMISSED)
            return;

        // Avoid sending the request multiple times
        if (notification._remoteClosed || notification.remoteId === undefined)
            return;

        notification._remoteClosed = true;

        const target = new GLib.Variant('(ssav)', [
            notification.deviceId,
            'notification.close',
            [GLib.Variant.new_string(notification.remoteId)],
        ]);
        const platformData = NotificationDaemon.getPlatformData();

        Gio.DBus.session.call(
            APP_ID,
            APP_PATH,
            'org.freedesktop.Application',
            'ActivateAction',
            new GLib.Variant('(sava{sv})', ['device', [target], platformData]),
            null,
            Gio.DBusCallFlags.NO_AUTO_START,
            -1,
            null,
            (connection, res) => {
                try {
                    connection.call_finish(res);
                } catch {
                    // Silence errors
                }
            }
        );
    }

    /*
     * Override to control notification spawning
     */
    addNotification(notificationId, notificationParams, showBanner) {
        this._notificationPending = true;

        // Parse the id to determine if it's from a device
        let localId = notificationId;
        let idMatch, deviceId, remoteId;

        if ((idMatch = DEVICE_REGEX.exec(notificationId))) {
            [, deviceId, remoteId] = idMatch;
            localId = `${deviceId}|${remoteId}`;
        }

        // Check if this is a repeat
        let notification = this._notifications[localId];

        if (notification) {
            // Bail early If @notificationParams represents an exact repeat
            const title = notificationParams.title.unpack();
            const body = notificationParams.body
                ? notificationParams.body.unpack()
                : null;

            if (notification.title === title &&
                notification.bannerBodyText === body) {
                this._notificationPending = false;
                return;
            }

            notification.title = title;
            notification.bannerBodyText = body;

        // Device Notification
        } else if (idMatch) {
            notification = this._createNotification(notificationParams);
            notification.deviceId = deviceId;
            notification.remoteId = remoteId;

            notification.connect('destroy', (remoteNotification, reason) => {
                this._valentCloseNotification(remoteNotification, reason);
                delete this._notifications[localId];
            });

            this._notifications[localId] = notification;

        // Service Notification
        } else {
            notification = this._createNotification(notificationParams);
            notification.connect('destroy', () => {
                delete this._notifications[localId];
            });
            this._notifications[localId] = notification;
        }

        if (showBanner)
            this.showNotification(notification);
        else
            this.pushNotification(notification);

        this._notificationPending = false;
    }

    /*
     * Override to raise the usual notification limit from 3 to 10
     *
     * See: https://gitlab.gnome.org/GNOME/gnome-shell/blob/main/js/ui/messageTray.js
     */
    pushNotification(notification) {
        if (this.notifications.includes(notification))
            return;

        while (this.notifications.length >= 10)
            this.notifications.shift().destroy(MessageTray.NotificationDestroyedReason.EXPIRED);

        notification.connect('destroy', this._onNotificationDestroy.bind(this));
        notification.connect('notify::acknowledged', this.countUpdated.bind(this));
        this.notifications.push(notification);
        this.emit('notification-added', notification);

        this.countUpdated();
    }

    createBanner(notification) {
        return new NotificationBanner(notification);
    }
});


let _sourceAddedId = null;

/**
 * Callback for `MessageTray.MessageTray::source-added`.
 *
 * @param {MessageTray.MessageTray} messageTray - The message tray
 * @param {MessageTray.Source} source - The notification source
 */
function _onSourceAdded(messageTray, source) {
    if (source?._appId !== APP_ID)
        return;

    Object.assign(source, {
        _valentCloseNotification: Source.prototype._valentCloseNotification,
        addNotification: Source.prototype.addNotification,
        pushNotification: Source.prototype.pushNotification,
        createBanner: Source.prototype.createBanner,
    });
}

/** */
function _patchValentNotificationSource() {
    // This should only happen on versions of GNOME Shel older than GNOME 42
    if (_sourceAddedId)
        return;

    const source = Main.notificationDaemon._gtkNotificationDaemon._sources[APP_ID];

    if (source !== undefined) {
        Object.assign(source, {
            addNotification: Source.prototype.addNotification,
            pushNotification: Source.prototype.pushNotification,
            createBanner: Source.prototype.createBanner,
            _valentCloseNotification: Source.prototype._valentCloseNotification,
        });

        for (const notification of Object.values(source._notifications)) {
            const _id = notification.connect('destroy', (remoteNotification, reason) => {
                source?._valentCloseNotification(remoteNotification, reason);
                remoteNotification.disconnect(_id);
            });
        }
    }

    _sourceAddedId = Main.messageTray.connect('source-added', _onSourceAdded);
}

/** */
function _unpatchValentNotificationSource() {
    const source = Main.notificationDaemon._gtkNotificationDaemon._sources[APP_ID];

    if (source !== undefined) {
        Object.assign(source, {
            addNotification: _addNotification,
            createBanner: _createBanner,
            pushNotification: _pushNotification,
            _valentCloseNotification: undefined,
        });
    }

    if (_sourceAddedId) {
        Main.messageTray.disconnect('source-added', _sourceAddedId);
        _sourceAddedId = null;
    }
}

/** */
function _patchGtkNotificationSources() {
    // eslint-disable-next-line func-style
    const addNotification = function (notificationId, notificationParams, showBanner) {
        this._notificationPending = true;

        if (this._notifications[notificationId])
            this._notifications[notificationId].destroy(MessageTray.NotificationDestroyedReason.REPLACED);

        const notification = this._createNotification(notificationParams);
        notification.connect('destroy', (localNotification, reason) => {
            this?._valentRemoveNotification(localNotification, reason);
            delete this._notifications[notificationId];
        });
        this._notifications[notificationId] = notification;

        if (showBanner)
            this.showNotification(notification);
        else
            this.pushNotification(notification);

        this._notificationPending = false;
    };

    // eslint-disable-next-line func-style
    const _valentRemoveNotification = function (id, notification, reason) {
        if (reason !== MessageTray.NotificationDestroyedReason.DISMISSED)
            return;

        Gio.DBus.session.call(
            'org.gtk.Notifications',
            '/org/gtk/Notifications',
            'org.gtk.Notifications',
            'RemoveNotification',
            new GLib.Variant('(ss)', [this._appId, id]),
            null,
            Gio.DBusCallFlags.NO_AUTO_START,
            -1,
            null,
            null
        );
    };

    Object.assign(NotificationDaemon.GtkNotificationDaemonAppSource.prototype, {
        addNotification,
        _valentRemoveNotification,
    });
}

/** */
function _unpatchGtkNotificationSources() {
    Object.assign(NotificationDaemon.GtkNotificationDaemonAppSource.prototype, {
        addNotification: _addNotification,
        _valentRemoveNotification: undefined,
    });
}


/**
 * Patch notification sources.
 *
 * 1. Modify Valent's notification source so that devices are notified when
 *    their notifications are closed, repliable notifications get a text entry,
 *    exact duplicates are ignore and the limit on notification count is raised.
 *
 * 2. Ensure other applications call org.gtk.Notifications.RemoveNotification()
 *    when notifications are dismissed.
 */
function patchNotificationSources() {
    _patchValentNotificationSource();
    _patchGtkNotificationSources();
}

/**
 * Revert the modifications performed in patchNotificationSources().
 */
function unpatchNotificationSources() {
    _unpatchValentNotificationSource();
    _unpatchGtkNotificationSources();
}

