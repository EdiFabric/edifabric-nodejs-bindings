#!/usr/bin/env bash
# Build the npm packages, smoke-test the one for this machine, and publish them.
#
# Usage: scripts/release.sh [--dry-run] [--tag <dist-tag>] [--skip-fetch]
# Publishing needs `npm login` or an NPM_TOKEN in ~/.npmrc with publish rights to edifabric-x12
# and the @edifabric scope. Set NPM_CONFIG_PROVENANCE=true in CI to attach provenance.
set -euo pipefail
cd "$(dirname "$0")/.."

dry_run=0; tag=latest; fetch=1
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) dry_run=1 ;;
    --tag) tag="$2"; shift ;;
    --skip-fetch) fetch=0 ;;
    *) echo "unknown argument $1" >&2; exit 2 ;;
  esac
  shift
done

node -e 'if (+process.versions.node.split(".")[0] < 18) { console.error("Node.js 18 or later is required"); process.exit(1); }'

[ "$fetch" = 1 ] && bash scripts/fetch-natives.sh natives
node scripts/build-packages.mjs

# Smoke test: install the packed main package and this machine's platform package into a scratch project.
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
platform="x12-$(node -p 'process.platform')-$(node -p 'process.arch')"
main_tgz="$(cd "$work" && npm pack --silent "$OLDPWD/dist/npm/edifabric-x12")"
platform_tgz="$(cd "$work" && npm pack --silent "$OLDPWD/dist/npm/$platform")"
(cd "$work" && npm init -y >/dev/null && npm install --silent --no-audit --no-fund "./$main_tgz" "./$platform_tgz")
cp scripts/smoke-test.cjs "$work/"
(cd "$work" && node smoke-test.cjs)

publish_args=(--access public --tag "$tag")
[ "$dry_run" = 1 ] && publish_args+=(--dry-run)
# Skip versions already on npm, so a release that failed partway can be rerun.
publish() {
  local id
  id=$(node -p "const p = require('./$1/package.json'); p.name + '@' + p.version")
  if [ -n "$(npm view "$id" version 2>/dev/null)" ]; then
    echo "$id is already published; skipping"
    return
  fi
  npm publish "$1" "${publish_args[@]}"
}

# Platform packages first, so the main package's optional dependencies resolve.
for dir in dist/npm/x12-*; do
  publish "$dir"
done
publish dist/npm/edifabric-x12
[ "$dry_run" = 1 ] && echo "Dry run: nothing was published."
exit 0
