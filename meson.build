# SPDX-License-Identifier: GPL-3.0-or-later
# SPDX-FileCopyrightText: 2022 Andy Holmes <andrew.g.r.holmes@gmail.com>

project('gnome-shell-extension-valent',
        license: 'GPL-3.0-or-later',
        version: '1.alpha',
  meson_version: '>= 0.56.0',
)

i18n = import('i18n')

extname = 'Valent'
extuuid = 'valent@andyholmes.ca'


# Paths
prefix = get_option('prefix')
datadir = join_paths(prefix, get_option('datadir'))
libdir = join_paths(prefix, get_option('libdir'))
localedir = join_paths(prefix, get_option('localedir'))

extensionsdir = join_paths(datadir, 'gnome-shell', 'extensions')
pluginsdir = join_paths(libdir, 'valent', 'plugins')


# Install
subdir('po')
subdir('src')

if get_option('tests')
  subdir('tests')
endif


# Build Summary
summary({
  'Tests': get_option('tests'),
}, section: 'Build')

