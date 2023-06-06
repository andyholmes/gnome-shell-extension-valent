[![CD](https://github.com/andyholmes/gnome-shell-extension-valent/actions/workflows/cd.yml/badge.svg)](https://github.com/andyholmes/gnome-shell-extension-valent/actions/workflows/cd.yml)

# Valent (GNOME Shell Extension)

**GNOME Shell integration for Valent**

[Valent][valent] is an implementation of the [KDE Connect][kdeconnect] protocol,
built on [GNOME][gnome] platform libraries.

This GNOME Shell extension helps Valent integrate with the GNOME desktop.

## Installation

The only requirements for building the project are `meson`, `gettext` and `zip`.

The helper script `build-aux/misc/ego.sh` will build a user extension that can
be installed with `gnome-extensions`:

```sh
./build-aux/misc/ego.sh
gnome-extensions install --force valent@andyholmes.ca.zip
```

To build and install as a system extension, run `meson` with the appropriate
arguments for your distribution:

```sh
meson setup --prefix=/usr _build
meson install -C _build
```

## Status

This project is in an early stage of development, with no stable releases. For
those interested in trying out GNOME Shell integration for Valent, there are
nightly builds available as an [extension ZIP][extension-zip].

Join the community in [Discussions] to ask questions, share ideas and get
involved in Valent!

[discussions]: https://github.com/andyholmes/valent/discussions
[extension-zip]: https://nightly.link/andyholmes/gnome-shell-extension-valent/workflows/cd/main/valent@andyholmes.ca.zip
[flatseal]: https://flathub.org/apps/details/com.github.tchx84.Flatseal
[gnome]: https://www.gnome.org
[kdeconnect]: https://kdeconnect.kde.org
[valent]: https://github.com/andyholmes/valent

