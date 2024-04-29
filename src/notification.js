// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: Andy Holmes <andrew.g.r.holmes@gmail.com>

import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Calendar from 'resource:///org/gnome/shell/ui/calendar.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import {GtkNotificationDaemonAppSource} from 'resource:///org/gnome/shell/ui/notificationDaemon.js';

const APPLICATION_ID = 'ca.andyholmes.Valent';
const APPLICATION_PATH = '/ca/andyholmes/Valent';
const DEVICE_REGEX = /^(.+?)::notification::(.+)$/;

function _getPlatformData() {
    const startupId = GLib.Variant.new('s', `_TIME${global.get_current_time()}`);
    return {'desktop-startup-id': startupId};
}

/**
 * A custom `Calendar.NotificationMessage` for repliable notifications.
 */
class NotificationMessage extends Calendar.NotificationMessage {
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

    /**
     * Add a reply button and entry
     *
     * When the reply button is clicked, all notification buttons are hidden
     * and the reply entry is revealed with active keyboard focus.
     *
     * When the reply entry is activated, unfocused or receives a keypress event
     * that would cause it to lose focus, the original state is restored.
     */
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
        button.connect('clicked', () => this._toggleReplyEntry(true));
        this._buttonBox.add_child(button);

        this._replyEntry = new St.Entry({
            can_focus: true,
            // TRANSLATORS: A reply entry in a notification
            hint_text: _('Type a message'),
            style_class: 'notification-button valent-reply-entry',
            input_hints: Clutter.InputContentHintFlags.SPELLCHECK,
            input_purpose: Clutter.InputContentPurpose.NORMAL,
            x_expand: true,
            visible: false,
        });
        this._replyEntry.clutter_text.connect('activate',
            this._onEntryActivated.bind(this));
        this._buttonBox.add_child(this._replyEntry);
    }

    _toggleReplyEntry(showEntry = false) {
        for (const child of this._buttonBox.get_children()) {
            if (child === this._replyEntry)
                child.visible = showEntry;
            else
                child.visible = !showEntry;
        }

        this._replyEntry.clutter_text.text = '';

        if (this._replyEntry?.visible) {
            this._replyEntry.grab_key_focus();
            this._replyFocusOutId = this._replyEntry.clutter_text.connect(
                'key-focus-out', () => this._toggleReplyEntry(false));
            this._replyPressEventId = this._replyEntry.clutter_text.connect(
                'key-press-event',
                (actor, event) => {
                    switch (event.get_key_symbol()) {
                    case Clutter.KEY_Escape:
                    case Clutter.KEY_ISO_Left_Tab:
                    case Clutter.KEY_Tab:
                        this._toggleReplyEntry(false);
                        return Clutter.EVENT_STOP;

                    default:
                        return Clutter.EVENT_PROPAGATE;
                    }
                });
        } else {
            if (this._replyFocusOutId) {
                this._replyEntry.clutter_text.disconnect(this._replyFocusOutId);
                this._replyFocusOutId = null;
            }

            if (this._replyPressEventId) {
                this._replyEntry.clutter_text.disconnect(this._replyPressEventId);
                this._replyPressEventId = null;
            }

            // FIXME: the keyboard focus is yielded to the notification banner,
            //        but it still gets lost in `Calendar.NotificationSection`
            global.stage.set_focus(null);
            this.grab_key_focus();
        }
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

        this._toggleReplyEntry(false);
    }
}

/**
 * A mix-in class for `NotificationDaemon.GtkNotificationDaemonAppSource`.
 */
class _Source {
    _valentBindNotification(notification) {
        if (notification._valentDestroyId) {
            notification.disconnect(notification._valentDestroyId);
            notification._valentDestroyId = null;
            return;
        }

        if (this?._appId === APPLICATION_ID) {
            const deviceNotificationId = DEVICE_REGEX.exec(notification.id);
            if (deviceNotificationId) {
                const [, deviceId, remoteId] = deviceNotificationId;
                notification.set({deviceId, remoteId});
                notification._valentDestroyId = notification.connect(
                    'destroy',
                    (_notification, reason) => {
                        this._valentCloseNotification(notification, reason);
                    });
            }
        } else {
            notification._valentDestroyId = notification.connect(
                'destroy',
                (_notification, reason) => {
                    this._valentRemoveNotification(notification, reason);
                });
        }
    }

    _valentCloseNotification(notification, reason) {
        if (reason !== MessageTray.NotificationDestroyedReason.DISMISSED)
            return;

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

    _valentRemoveNotification(notification, reason) {
        if (reason !== MessageTray.NotificationDestroyedReason.DISMISSED)
            return;

        Gio.DBus.session.call(
            'org.gtk.Notifications',
            '/org/gtk/Notifications',
            'org.gtk.Notifications',
            'RemoveNotification',
            new GLib.Variant('(ss)', [this._appId, notification.id]),
            null,
            Gio.DBusCallFlags.NO_AUTO_START,
            -1,
            null,
            null);
    }

    /**
     * Override for device notifications.
     *
     * This ensures remote devices are notified when their notifications are
     * closed by the user. For notifications from other applications, it ensures
     * `org.gtk.Notifications.Remove()` is invoked to notify Valent.
     */
    addNotification(notification) {
        this._notificationPending = true;

        // valent-modifications-begin
        this._valentBindNotification(notification);
        // valent-modifications-end

        this._notifications[notification.id]?.destroy(
            MessageTray.NotificationDestroyedReason.REPLACED);

        notification.connect('destroy', () => {
            delete this._notifications[notification.id];
        });
        this._notifications[notification.id] = notification;

        // valent-modifications-begin
        MessageTray.Source.prototype.addNotification.call(this, notification);
        // valent-modifications-end

        this._notificationPending = false;
    }
}

function rebindNotificationSource() {
    // Connect (or disconnect) from application notifications
    const sources = Main.notificationDaemon._gtkNotificationDaemon._sources;
    for (const source of Object.values(sources)) {
        for (const notification of Object.values(source._notifications))
            source._valentBindNotification(notification);
    }
}

/**
 * Enable modifications to the notification system
 *
 * @param {InjectionManager} injectionManager - a manager for any class
 *   instance or prototype modifications.
 */
export function enable(injectionManager) {
    injectionManager.overrideMethod(GtkNotificationDaemonAppSource.prototype,
        '_valentBindNotification',
        () => _Source.prototype._valentBindNotification);
    injectionManager.overrideMethod(GtkNotificationDaemonAppSource.prototype,
        '_valentCloseNotification',
        () => _Source.prototype._valentCloseNotification);
    injectionManager.overrideMethod(GtkNotificationDaemonAppSource.prototype,
        '_valentRemoveNotification',
        () => _Source.prototype._valentRemoveNotification);
    injectionManager.overrideMethod(GtkNotificationDaemonAppSource.prototype,
        'addNotification',
        () => _Source.prototype.addNotification);

    rebindNotificationSource();
}

/**
 * Disable modifications to the notification system
 *
 * @param {InjectionManager} injectionManager - a manager for any class
 *   instance or prototype modifications.
 */
export function disable(injectionManager) {
    rebindNotificationSource();

    injectionManager.restoreMethod(GtkNotificationDaemonAppSource.prototype,
        '_valentBindNotification');
    injectionManager.restoreMethod(GtkNotificationDaemonAppSource.prototype,
        '_valentCloseNotification');
    injectionManager.restoreMethod(GtkNotificationDaemonAppSource.prototype,
        '_valentRemoveNotification');
    injectionManager.restoreMethod(GtkNotificationDaemonAppSource.prototype,
        'addNotification');
}

