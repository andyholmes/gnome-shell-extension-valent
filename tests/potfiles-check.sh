#!/usr/bin/env bash

# SPDX-License-Identifier: CC0-1.0
# SPDX-FileCopyrightText: No rights reserved

srcdirs="src"

# find source files that contain gettext keywords
# shellcheck disable=SC2086
files=$(grep -lR --include='*.js' '\(gettext\|[^_)]_\)(' $srcdirs)

# filter out excluded files
if [ -f po/POTFILES.skip ]; then
  files=$(for f in $files; do ! grep -q ^"$f" po/POTFILES.skip && echo "$f"; done)
fi

# find those that aren't listed in POTFILES.in
missing=$(for f in $files; do ! grep -q ^"$f" po/POTFILES.in && echo "$f"; done)

if [ ${#missing} -eq 0 ]; then
  exit 0
fi

cat >&2 <<EOT

The following files are missing from po/POTFILES.in:

EOT
for f in $missing; do
  echo "  $f" >&2
done
echo >&2

if [ "${GITHUB_ACTIONS}" = "true" ]; then
    {
      echo "### POTFILES"
      echo "Missing from po/POTFILES.in:"
      echo "\`\`\`"
      for f in $missing; do
        echo "$f"
      done
      echo "\`\`\`"
    } >> "${GITHUB_STEP_SUMMARY}";
fi

exit 1

