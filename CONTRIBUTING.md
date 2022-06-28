# Contributing

Thanks for thinking about contributing to Valent!

Valent is an implementation of the KDE Connect protocol, built on GNOME platform
libraries. This GNOME Shell extension helps Valent integrate into the GNOME
desktop environment.

Please note that the primary goal of this project is to improve integration with
session components, not to provide a user interface for Valent. Many features
from [GSConnect][gsconnect] you may be familiar with will not be implemented.


## Reporting an Issue

This project is currently in an early stage of development and not accepting bug
reports. Along with missing features, there are a number of pending changes in
Valent that will influence its development.

Until the project is ready to start accepting reports, you are invited to
discuss issues, features and get help in the [Discussions][discussions].


## Workflow

This project uses a simple feature branch workflow, with commit messages
following the [Conventional Commits][conventional-commits] standard.

Simply create a new branch off of `main` to do your work, separate your changes
into commits as appropriate and then open a pull request for review. Don't worry
if any of this is unfamiliar, since this can be fixed up before merging.


## Submitting a Translation

This project does not yet use a translation service like Weblate or Crowdin. You
should also expect translatable strings to change frequently until the project
is more mature.

To contribute a translation, open a pull request which adds your locale to the
[`LINGUAS`][linguas] file and your translated `.po` file to the [`po/`][po_dir]
directory.


## Contributing Code

This projects follows most of the conventions of a typical GNOME project
including coding style, documentation and introspection, with an emphasis on
automated testing.


### Coding Style

This project follows the [GNOME Shell Coding Style][gnome-shell-coding-style],
enforced by ESLint configuration. When in doubt, simply submit your code and the
CI will let you know if something needs to be changed.


### Testing

The CI will run `eslint` on the GNOME Shell extension and `pylint` on the
Python3 plugin, but has no unit tests. Be sure to manually test the
functionality of any changes you submit for review.


## Licensing

The following table describes the preferred licensing for various types of
contributions:

| Type                                   | License            |
|----------------------------------------|--------------------|
| Code                                   | `GPL-3.0-or-later` |
| Translations                           | `GPL-3.0-or-later` |
| Other (icons, metadata, configuration) | `CC0-1.0`          |

Contributions may be accepted under other licensing, such as code or icons
already distributed under an acceptable open source license.


[conventional-commits]: https://www.conventionalcommits.org
[discussions]: https://github.com/andyholmes/gnome-shell-extension-valent/discussions
[gnome-shell-coding-style]: https://gitlab.gnome.org/GNOME/gnome-shell/tree/main/lint
[gsconnect]: https://github.com/GSConnect/gnome-shell-extension-gsconnect
[linguas]: https://github.com/andyholmes/gnome-shell-extension-valent/blob/main/po/LINGUAS
[po_dir]: https://github.com/andyholmes/gnome-shell-extension-valent/tree/main/po

