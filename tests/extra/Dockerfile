# SPDX-License-Identifier: CC0-1.0
# SPDX-FileCopyrightText: No rights reserved

FROM fedora:35

RUN dnf install -y --setopt=install_weak_deps=False \
        gettext git meson nodejs python3-gobject python3-pip yarnpkg zip && \
    dnf clean all && \
    rm -rf /var/cache/yum

# TODO: https://github.com/gajus/eslint-plugin-jsdoc/issues/795
# RUN: pip install pylint && \
#      yarnpkg global add eslint eslint-plugin-jsdoc

