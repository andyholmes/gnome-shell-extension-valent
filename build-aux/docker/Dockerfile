# SPDX-License-Identifier: CC0-1.0
# SPDX-FileCopyrightText: No rights reserved

FROM registry.fedoraproject.org/fedora:41

# The packages below only include build tooling; the CI handles testing itself
RUN dnf install -y --setopt=install_weak_deps=False \
        gettext git meson zip && \
    dnf clean all && rm -rf /var/cache/dnf

