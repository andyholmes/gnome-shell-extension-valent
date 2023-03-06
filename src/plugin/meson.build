# SPDX-License-Identifier: GPL-3.0-or-later
# SPDX-FileCopyrightText: Andy Holmes <andrew.g.r.holmes@gmail.com>

plugin_sources = [
  'gnome-shell/__init__.py',
]

plugin_conf = configuration_data()
plugin_conf.set('PLUGIN_VERSION', meson.project_version())
plugin_info = configure_file(
          input: 'gnome-shell.plugin.in',
         output: 'gnome-shell.plugin',
  configuration: plugin_conf,
)

install_data(plugin_sources,
             plugin_info,
  install_dir: join_paths(pluginsdir, 'gnome-shell'),
       rename: [
         'gnome-shell/__init__.py',
         'gnome-shell.plugin'
       ],
)

