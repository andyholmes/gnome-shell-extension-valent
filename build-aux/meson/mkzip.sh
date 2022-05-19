#!/bin/sh

# SPDX-License-Identifier: CC0-1.0
# SPDX-FileCopyrightText: No rights reserved


export DESTDIR="${MESON_BUILD_ROOT}/_zip"

ZIP_DIR="${MESON_BUILD_ROOT}/${UUID}"
ZIP_FILE="${MESON_BUILD_ROOT}/${UUID}.zip"


# PRE-CLEAN
rm -rf ${DESTDIR} ${ZIP_DIR} ${ZIP_FILE}

# BUILD
if ! ninja -C ${MESON_BUILD_ROOT} install > /dev/null; then
  exit 1;
fi

# COPY
mkdir -p ${ZIP_DIR}/plugin
cp -pr ${DESTDIR}/${DATADIR}/gnome-shell/extensions/${UUID}/* ${ZIP_DIR}
cp -pr ${DESTDIR}/${LIBDIR}/valent/plugins/* ${ZIP_DIR}/plugin/
cp -pr ${DESTDIR}/${LOCALEDIR} ${ZIP_DIR}

# COMPRESS
cd ${ZIP_DIR}
zip -qr ${ZIP_FILE} .
echo "Extension saved to ${ZIP_FILE}"

# INSTALL
if [ "$INSTALL" = true ]; then
    EXTENSIONS_DIR="${HOME}/.local/share/gnome-shell/extensions"
    INSTALL_DIR="${EXTENSIONS_DIR}/${UUID}"

    mkdir -p ${EXTENSIONS_DIR}
    rm -rf ${INSTALL_DIR}
    unzip -q ${ZIP_FILE} -d ${INSTALL_DIR}

    echo "Extension installed to ${INSTALL_DIR}"
fi

