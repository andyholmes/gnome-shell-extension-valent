[![CD](https://github.com/andyholmes/gnome-shell-extension-valent/actions/workflows/cd.yml/badge.svg)](https://github.com/andyholmes/gnome-shell-extension-valent/actions/workflows/cd.yml)
[![Translated](https://hosted.weblate.org/widget/valent/gnome-shell-extension/svg-badge.svg)](https://hosted.weblate.org/engage/valent/)

# Valent (GNOME Shell Extension)

**GNOME Shell integration for Valent**

[Valent] is an implementation of the [KDE Connect] protocol, built on [GNOME]
platform libraries.

This GNOME Shell extension helps Valent integrate with the GNOME desktop.

Features:

* Quick settings tile in user menu
* Device overview in tile menu
* Panel indicator when connected
* Improved notification support
* More…

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

## Compatibility

This extension supports the latest, stable release of GNOME Shell.

When support for a new version of GNOME Shell is about to be added, a new
branch is made effectively halting development for the current version.
Contributions are welcome with bug fixes that target these branches, but no
new features or changes to translatable strings will be accepted.

Note that compatibility with [Valent] may also depend on a particular version,
since the extension communicates with the D-Bus service.

## Status

This project is in an early stage of development, with no stable releases. For
those interested in trying out GNOME Shell integration for Valent, there are
nightly builds available as an [extension ZIP].

Join the community in [Discussions] to ask questions, share ideas and get
involved in Valent!

## Acknowledgements

Translation services for Valent are provided courtesy of [Weblate].

[Discussions]: https://github.com/andyholmes/valent/discussions
[extension ZIP]: https://nightly.link/andyholmes/gnome-shell-extension-valent/workflows/cd/main/valent@andyholmes.ca.zip
[GNOME]: https://www.gnome.org
[KDE Connect]: https://kdeconnect.kde.org
[Valent]: https://github.com/andyholmes/valent
[Weblate]: https://weblate.org

