# SPDX-License-Identifier: GPL-3.0-or-later
# SPDX-FileCopyrightText: Andy Holmes <andrew.g.r.holmes@gmail.com>

extension_sources = [
  'extension.js',
  'notification.js',
  'remote.js',
  'status.js',
  'stylesheet.css',
]

metadata_conf = configuration_data()
metadata_conf.set('EXTENSION_NAME', extname)
metadata_conf.set('EXTENSION_UUID', extuuid)
metadata_conf.set('EXTENSION_VERSION', meson.project_version())
metadata_conf.set('GETTEXT_DOMAIN', meson.project_name())
metadata_json = configure_file(
          input: 'metadata.json.in',
         output: 'metadata.json',
  configuration: metadata_conf,
)

install_data(extension_sources,
             metadata_json,
  install_dir: join_paths(extensionsdir, extuuid),
)

install_subdir('icons',
  install_dir: join_paths(extensionsdir, extuuid),
)

