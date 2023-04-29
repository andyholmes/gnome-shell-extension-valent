#!/bin/sh -e

# SPDX-License-Identifier: CC0-1.0
# SPDX-FileCopyrightText: No rights reserved

if [ -z "${DESTDIR}" ]; then
    DESTDIR=$(mktemp -d) && export DESTDIR
fi

if [ -z "${WORKSPACE}" ]; then
    WORKSPACE=$(git rev-parse --show-toplevel)
fi


BUILDDIR="${WORKSPACE}"/_ego
UUID="valent@andyholmes.ca"
ZIPDIR="${DESTDIR}/${UUID}"


# Setup
meson setup --prefix=/usr \
            "${BUILDDIR}"
meson install -C "${BUILDDIR}"

# Copy the installed files into a zippable directory
mkdir -p "${ZIPDIR}"
cp -pr "${DESTDIR}"/usr/share/gnome-shell/extensions/"${UUID}"/* "${ZIPDIR}"
cp -pr "${DESTDIR}"/usr/share/locale "${ZIPDIR}"

# Pack the directory contents into a distributable Zip
cd "${ZIPDIR}"
zip -qr "${WORKSPACE}/${UUID}.zip" .

echo "Extension saved to ${WORKSPACE}/${UUID}.zip"

