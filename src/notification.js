// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: Andy Holmes <andrew.g.r.holmes@gmail.com>

import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Calendar from 'resource:///org/gnome/shell/ui/calendar.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import {GtkNotificationDaemonAppSource} from 'resource:///org/gnome/shell/ui/notificationDaemon.js';

const APPLICATION_ID = 'ca.andyholmes.Valent';
const APPLICATION_PATH = '/ca/andyholmes/Valent';
const DEVICE_REGEX = /^(.+?)::notification::(.+)$/;

// Overrides
const MAX_NOTIFICATIONS_PER_SOURCE = 9;

const appSourceMethods = {
    addNotification: GtkNotificationDaemonAppSource.prototype.addNotification,
    createBanner: GtkNotificationDaemonAppSource.prototype.createBanner,
    pushNotification: GtkNotificationDaemonAppSource.prototype.pushNotification,
    _valentCloseNotification: undefined,
    _valentRemoveNotification: undefined,
};


function _getPlatformData() {
    const startupId = GLib.Variant.new('s', `_TIME${global.get_current_time()}`);
    return {'desktop-startup-id': startupId};
}

/**
 * A custom Notification Banner with an entry field.
 */
class NotificationBanner extends Calendar.NotificationMessage {
    static {
        GObject.registerClass(this);
    }

    constructor(notification) {
        super(notification);

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
                style_class: 'notification-buttons-bin',
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

        Gio.DBus.session.call(
            APPLICATION_ID,
            APPLICATION_PATH,
            'org.freedesktop.Application',
            'ActivateAction',
            new GLib.Variant('(sava{sv})', ['device', [target],
                _getPlatformData()]),
            null,
            Gio.DBusCallFlags.NO_AUTO_START,
            -1,
            null,
            null);

        // We want the notification banner to disappear, but we don't want
        // close() to be invoked, because that will result in the notification
        // being destroyed.
        this._closed = true;
        this.destroy();
    }
}


/**
 * A custom notification source for Valent.
 */
class Source extends GtkNotificationDaemonAppSource {
    static {
        GObject.registerClass(this);
    }

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

        Gio.DBus.session.call(
            APPLICATION_ID,
            APPLICATION_PATH,
            'org.freedesktop.Application',
            'ActivateAction',
            new GLib.Variant('(sava{sv})', ['device', [target],
                _getPlatformData()]),
            null,
            Gio.DBusCallFlags.NO_AUTO_START,
            -1,
            null,
            null);
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

        let notification = this._notifications[localId];

        /* Check if existing notifications represent an exact repeat and return
         * early if so. Otherwise, update the notification title and body. */
        if (notification) {
            const title = notificationParams.title.unpack();
            const body = notificationParams?.body.unpack() || null;

            if (notification.title === title &&
                notification.bannerBodyText === body) {
                this._notificationPending = false;
                return;
            }

            notification.title = title;
            notification.bannerBodyText = body;

        /* Notify the device when remote notifications are dismissed */
        } else if (idMatch) {
            notification = this._createNotification(notificationParams);
            notification.deviceId = deviceId;
            notification.remoteId = remoteId;

            notification.connect('destroy', (remoteNotification, reason) => {
                this._valentCloseNotification(remoteNotification, reason);
                delete this._notifications[localId];
            });
            this._notifications[localId] = notification;

        /* All other notifications are treated as local desktop notifications */
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
     * Override to raise the usual notification limit from 3.
     *
     * See: https://gitlab.gnome.org/GNOME/gnome-shell/blob/main/js/ui/messageTray.js
     */
    pushNotification(notification) {
        if (this.notifications.includes(notification))
            return;

        while (this.notifications.length >= MAX_NOTIFICATIONS_PER_SOURCE)
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
}


let _sourceAddedId = null;

function _onSourceAdded(messageTray, source) {
    if (source?._appId !== APPLICATION_ID)
        return;

    Object.assign(source, {
        _valentCloseNotification: Source.prototype._valentCloseNotification,
        addNotification: Source.prototype.addNotification,
        pushNotification: Source.prototype.pushNotification,
        createBanner: Source.prototype.createBanner,
    });
}

export function enable() {
    // Patch Valent's notification source
    const gtkNotifications = Main.notificationDaemon._gtkNotificationDaemon;
    const source = gtkNotifications._sources[APPLICATION_ID];

    if (source) {
        Object.assign(source, {
            _valentCloseNotification: Source.prototype._valentCloseNotification,
            addNotification: Source.prototype.addNotification,
            pushNotification: Source.prototype.pushNotification,
            createBanner: Source.prototype.createBanner,
        });

        for (const notification of Object.values(source._notifications)) {
            const _id = notification.connect('destroy', (remoteNotification, reason) => {
                source?._valentCloseNotification(remoteNotification, reason);
                remoteNotification.disconnect(_id);
            });
        }
    }

    _sourceAddedId = Main.messageTray.connect('source-added', _onSourceAdded);

    // Patch other applications' notification sources
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
            null);
    };

    Object.assign(GtkNotificationDaemonAppSource.prototype, {
        addNotification,
        _valentRemoveNotification,
    });
}

export function disable() {
    if (_sourceAddedId) {
        Main.messageTray.disconnect(_sourceAddedId);
        _sourceAddedId = null;
    }

    const gtkNotifications = Main.notificationDaemon._gtkNotificationDaemon;
    const source = gtkNotifications._sources[APPLICATION_ID];

    if (source)
        Object.assign(source, appSourceMethods);

    Object.assign(GtkNotificationDaemonAppSource.prototype, appSourceMethods);
}

