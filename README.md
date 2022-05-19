[![CI](https://github.com/andyholmes/gnome-shell-extension-valent/actions/workflows/ci.yml/badge.svg)](https://github.com/andyholmes/gnome-shell-extension-valent/actions/workflows/ci.yml)

# Valent (GNOME Shell Extension)

[Valent][valent] is an implementation of the [KDE Connect][kdeconnect] protocol,
built on [GNOME][gnome] platform libraries.

This GNOME Shell extension helps Valent integrate with the GNOME desktop. The
bundled Python plugin is used by Valent to communicate with the extension.

## Installation

For installation as a user extension:

```sh
meson _build
ninja -C _build install-zip
```

For installation as a system extension:

```sh
meson --prefix=/usr _build
sudo ninja -C build install
```

### Sandbox Permissions

If Valent is running in a Flatpak sandbox, the extension must be installed as
a user extension. The application will need your permission to talk to
`org.gnome.Shell` on the session bus and access the filesystem at
`XDG_DATA_HOME/valent/plugins/gnome-shell`.

These permissions can be granted using [Flatseal][flatseal] or with the
`flatpak override` command:

```
flatpak override --user \
                 --filesystem=xdg-data/valent/plugins/gnome-shell \
                 --talk-name=org.gnome.Shell \
                 ca.andyholmes.Valent
```

## Status

This is not a public project, meaning:

* There are no releases or builds
* Bug reports, features requests and code submissions are not accepted
* It is untested, unstable and unsupported

If you choose to distribute or run this extension, you take responsibility for
providing support.


[valent]: https://github.com/andyholmes/valent
[flatseal]: https://flathub.org/apps/details/com.github.tchx84.Flatseal
[gnome]: https://www.gnome.org
[kdeconnect]: https://kdeconnect.kde.org

