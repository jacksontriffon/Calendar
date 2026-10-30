#!/usr/bin/env bash
# Prepares supabase/functions for `deno check`, `deno test`, `supabase functions serve` and
# `supabase functions deploy`:
#   1. copies packages/core/src -> _shared/core/ (the "@calendar/core" import map target), and
#   2. generates _shared/skills.generated.ts from skills/ (the inline-skills transport of
#      ai-schedule needs the skill files at runtime, and the bundle can't read ../../skills).
# Both outputs are untracked (see .gitignore here). Run it again whenever packages/core or
# skills/ change.
#
# Why a copy: the Supabase CLI documents import maps and shared code only inside
# supabase/functions; a path like ../../packages/core/src is not documented as bundled by
# `functions deploy` (Docker bundler) or `--use-api`, so we don't rely on it. See supabase/README.md.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"

rm -rf "$HERE/_shared/core"
mkdir -p "$HERE/_shared/core"
cp -R "$ROOT/packages/core/src/." "$HERE/_shared/core/"
echo "synced packages/core/src -> supabase/functions/_shared/core ($(find "$HERE/_shared/core" -name '*.ts' | wc -l | tr -d ' ') files)"

node "$HERE/gen-skills.mjs" "$ROOT/skills" "$HERE/_shared/skills.generated.ts"
