#!/usr/bin/env bash
# PostToolUse hook: warn when a modules/*.ts file contains the literal substring
# "export" more than once. scripts/build.ts (isolate-modules plugin) splits each
# module's output on "export" expecting EXACTLY two parts (body + the single
# `export { name }`). Any extra occurrence — in a string, comment, or identifier —
# adds a third split and the build fails with "Unexpected number of exports".
# Surfaces a non-blocking warning so it is caught before `bun run build`.
set -euo pipefail

f="$(jq -r '.tool_input.file_path // .tool_response.filePath // empty')"
[ -z "$f" ] && exit 0

case "$f" in
  */modules/*.ts)
    [ -f "$f" ] || exit 0
    n="$(grep -o "export" "$f" 2>/dev/null | wc -l | tr -d ' ')"
    if [ "${n:-0}" -gt 1 ]; then
      jq -n --arg f "$f" --arg n "$n" '{
        systemMessage: ("⚠ \($f): the substring \"export\" appears \($n)× — scripts/build.ts splits modules/*.ts on \"export\" expecting 2 parts, so `bun run build` will fail with \"Unexpected number of exports\". Use a synonym (dump / surface / output) in any string or comment.")
      }'
    fi
    ;;
esac
exit 0
