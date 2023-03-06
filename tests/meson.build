# SPDX-License-Identifier: GPL-3.0-or-later
# SPDX-FileCopyrightText: Andy Holmes <andrew.g.r.holmes@gmail.com>

# Lint JavaScript
eslint = find_program('eslint', required: false)

if eslint.found()
  test('ESLint', eslint,
           args: join_paths(meson.project_source_root(), 'src', 'extension'),
    is_parallel: true,
          suite: 'lint',
  )
endif

# Lint Python
pylint = find_program('pylint', required: false)

if pylint.found()
  test('Pylint', pylint,
           args: join_paths(meson.project_source_root(), 'src', 'plugin', 'gnome-shell'),
    is_parallel: true,
          suite: 'lint',
  )
endif

