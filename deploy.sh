#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

npx --yes wrangler@latest deploy "$@"
