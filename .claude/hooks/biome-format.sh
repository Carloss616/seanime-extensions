#!/usr/bin/env bash
# PostToolUse hook: format/lint-fix edited TypeScript files with the project's Biome.
# Safe fixes only (no --unsafe) so it never renames identifiers or makes risky rewrites.
# Reads the Claude Code hook payload (JSON) on stdin.
set -euo pipefail

f="$(jq -r '.tool_input.file_path // .tool_response.filePath // empty')"
[ -z "$f" ] && exit 0

case "$f" in
  *.ts) bunx biome check --write "$f" >/dev/null 2>&1 || true ;;
esac
exit 0
