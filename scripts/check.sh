#!/usr/bin/env bash
# Snelle feedback: volledige testsuite + typecheck.
set -e
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/opt/node-v22.23.4-linux-x64/bin:$HOME/.local/bin:$PATH"

echo "== tests =="
pnpm test 2>&1 | grep -E "Test Files|Tests |FAIL" || exit 1

echo "== typecheck =="
pnpm typecheck > /tmp/typecheck.log 2>&1 && echo "typecheck OK" || { grep -E "error TS" /tmp/typecheck.log | head -10; exit 1; }
