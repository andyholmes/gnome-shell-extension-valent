// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: Andy Holmes <andrew.g.r.holmes@gmail.com>

import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import Graphene from 'gi://Graphene';
import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageList from 'resource:///org/gnome/shell/ui/messageList.js';
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
 * A custom `MessageList.NotificationMessage` for repliable notifications.
 */
class NotificationMessage extends MessageList.NotificationMessage {
    static {
        GObject.registerClass(this);
    }

    constructor(notification) {
        super(notification);

        if (this.notification._defaultAction === 'app.device') {
            const [
                _deviceId,
                deviceActionName,
                [_deviceActionTarget],
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

        if (showEntry) {
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

            global.stage.set_key_focus(this.get_parent());
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
            _replyMessage,
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
 * A mix-in class for the `MessageTray.MessageTray`.
 *
 * Note that these are the popup notifications that appear on the desktop,
 * not the grouped notifications that appear in the date menu.
 */
class _MessageTray {
    /**
     * Override for device notifications.
     *
     * This ensures device notifications that support replies are given a
     * custom `MessageList.NotificationMessage` with a reply button and entry.
     */
    _showNotification() {
        this._notification = this._notificationQueue.shift();
        this.emit('queue-changed');

        this._userActiveWhileNotificationShown = this.idleMonitor.get_idletime() <= 1000;
        if (!this._userActiveWhileNotificationShown) {
            // If the user isn't active, set up a watch to let us know
            // when the user becomes active.
            this.idleMonitor.add_user_active_watch(this._onIdleMonitorBecameActive.bind(this));
        }

        // valent-modifications-begin
        this._banner = this._notification?.deviceId
            ? new NotificationMessage(this._notification)
            : new MessageList.NotificationMessage(this._notification);
        // valent-modifications-end
        this._banner.can_focus = false;
        this._banner._header.expandButton.visible = false;
        this._banner.add_style_class_name('notification-banner');

        this._bannerBin.add_child(this._banner);

        this._bannerBin.opacity = 0;
        this._bannerBin.y = -this._banner.height;
        this.show();

        global.compositor.disable_unredirect();
        this._updateShowingNotification();

        const [x, y] = global.get_pointer();
        // We save the position of the mouse at the time when we started showing the notification
        // in order to determine if the notification popped up under it. We make that check if
        // the user starts moving the mouse and _onNotificationHoverChanged() gets called. We don't
        // expand the notification if it just happened to pop up under the mouse unless the user
        // explicitly mouses away from it and then mouses back in.
        this._showNotificationMouseX = x;
        this._showNotificationMouseY = y;
        // We save the coordinates of the mouse at the time when we started showing the notification
        // and then we update it in _notificationTimeout(). We don't pop down the notification if
        // the mouse is moving towards it or within it.
        this._lastSeenMouseX = x;
        this._lastSeenMouseY = y;

        this._resetNotificationLeftTimeout();
    }
}

/**
 * Vendored wholesale from messageList.js
 */
const MESSAGE_ANIMATION_TIME = 100;
const ScaleLayout = GObject.registerClass({
    Properties: {
        'scaling-enabled': GObject.ParamSpec.boolean(
            'scaling-enabled', null, null,
            GObject.ParamFlags.READWRITE,
            true),
    },
}, class ScaleLayout extends Clutter.BinLayout {
    _container = null;
    _scalingEnabled = true;

    get scalingEnabled() {
        return this._scalingEnabled;
    }

    set scalingEnabled(value) {
        if (this._scalingEnabled === value)
            return;

        this._scalingEnabled = value;
        this.notify('scaling-enabled');
        this.layout_changed();
    }

    vfunc_set_container(container) {
        if (this._container === container)
            return;

        this._container?.disconnectObject(this);

        this._container = container;

        if (this._container) {
            this._container.connectObject(
                'notify::scale-x', () => this.layout_changed(),
                'notify::scale-y', () => this.layout_changed(), this);
        }
    }

    vfunc_get_preferred_width(container, forHeight) {
        const [min, nat] = super.vfunc_get_preferred_width(container, forHeight);

        if (this._scalingEnabled) {
            return [
                Math.floor(min * container.scale_x),
                Math.floor(nat * container.scale_x),
            ];
        } else {
            return [min, nat];
        }
    }

    vfunc_get_preferred_height(container, forWidth) {
        const [min, nat] = super.vfunc_get_preferred_height(container, forWidth);

        if (this._scalingEnabled) {
            return [
                Math.floor(min * container.scale_y),
                Math.floor(nat * container.scale_y),
            ];
        } else {
            return [min, nat];
        }
    }
});

/**
 * A mix-in class for the `MessageList.NotificationMessageGroup`.
 *
 * Note that these are the grouped notifications that appear in the date menu,
 * not the popup notifications that appear on the desktop.
 */
class _NotificationMessageGroup {
    /**
     * Override for device notifications.
     *
     * This ensures device notifications that support replies are given a
     * custom `MessageList.NotificationMessage` with a reply button and entry.
     *
     * @param {MessageTray.Notification} - an event notification
     */
    _addNotification(notification) {
        // valent-modifications-begin
        const message = this?.source?._appId === APPLICATION_ID
            ? new NotificationMessage(notification)
            : new MessageList.NotificationMessage(notification);
        // valent-modifications-end

        this._notificationToMessage.set(notification, message);

        notification.connectObject(
            'notify::urgency', () => {
                const isUrgent = notification.urgency === MessageTray.Urgency.CRITICAL;
                const oldHasUrgent = this.hasUrgent;

                if (isUrgent)
                    this._nUrgent++;
                else
                    this._nUrgent--;

                const index = isUrgent ? 0 : this._nUrgent;
                this._moveMessage(message, index);
                if (oldHasUrgent !== this.hasUrgent)
                    this.notify('has-urgent');
            }, message);

        const isUrgent = notification.urgency === MessageTray.Urgency.CRITICAL;
        const oldHasUrgent = this.hasUrgent;

        if (isUrgent)
            this._nUrgent++;

        const wasExpanded = this.expanded;
        const item = new St.Bin({
            child: message,
            canFocus: false,
            layout_manager: new ScaleLayout(),
            pivot_point: new Graphene.Point({x: .5, y: .5}),
            scale_x: 0,
            scale_y: 0,
        });

        message.connectObject(
            'key-focus-in', this._onKeyFocusIn.bind(this),
            'expanded', () => {
                if (!this.expanded)
                    this.emit('expand-toggle-requested');
            },
            'close', () => {
                // If the group is collapsed and one notification is closed, close the entire group
                if (!this.expanded) {
                    GObject.signal_stop_emission_by_name(message, 'close');
                    this.close();
                }
            },
            'clicked', () => {
                if (!this.expanded) {
                    GObject.signal_stop_emission_by_name(message, 'clicked');
                    this.emit('expand-toggle-requested');
                }
            }, this);

        let index = isUrgent ? 0 : this._nUrgent;
        // If we add a child below the top child we need to adjust index to skip the cover child
        if (index > 0)
            index += 1;

        this.insert_child_at_index(item, index);
        this._ensureCoverPosition();
        this._updateStackedMessagesFade();

        item.layout_manager.scalingEnabled = this._expanded;

        // The first message doesn't need to be animated since the entire group is animated
        if (this._notificationToMessage.size > 1) {
            item.ease({
                scale_x: 1,
                scale_y: 1,
                duration: MESSAGE_ANIMATION_TIME,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        } else {
            item.set_scale(1.0, 1.0);
        }

        if (wasExpanded !== this.expanded)
            this.notify('expanded');

        if (oldHasUrgent !== this.hasUrgent)
            this.notify('has-urgent');
        this.emit('notification-added');
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
        const current = this._notifications[notification.id];
        if (current?.deviceId && current.title === notification.title
            && current.body === notification.body) {
            this._notificationPending = false;
            return;
        }
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

    injectionManager.overrideMethod(MessageList.NotificationMessageGroup.prototype,
        '_addNotification',
        () => _NotificationMessageGroup.prototype._addNotification);
    injectionManager.overrideMethod(Main.messageTray,
        '_showNotification',
        () => _MessageTray.prototype._showNotification);

    rebindNotificationSource();
}

/**
 * Disable modifications to the notification system
 *
 * @param {InjectionManager} injectionManager - a manager for any class
 *   instance or prototype modifications.
 */
export function disable(injectionManager) {
    injectionManager.restoreMethod(MessageList.NotificationMessageGroup.prototype,
        '_addNotification');
    injectionManager.restoreMethod(Main.messageTray,
        '_showNotification');

    // This must be done after the notification section, but before the source
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

