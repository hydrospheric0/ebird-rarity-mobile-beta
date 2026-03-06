#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# pushit-beta.sh — build + deploy feat/international → BETA repo GitHub Pages
#
# This is a SEPARATE deploy script for the international / v0.7 development
# branch.  It does NOT touch main or the production gh-pages branch.
#
# Prerequisites
# ─────────────
#   1. Create a second GitHub repo, e.g.:
#        https://github.com/<YOUR_USER>/ebird-rarity-mobile-beta
#   2. Set BETA_REPO_URL below (or export it before running).
#
# Usage:
#   ./pushit-beta.sh [message]
#   ./pushit-beta.sh --release 0.7.0-beta.3 [message]
#
# Version scheme:  0.7.0-beta.N  (managed in this script via BETA_VERSION
# file; does not touch the main VERSION / package.json files)
# ---------------------------------------------------------------------------

# ── CONFIG — edit these ────────────────────────────────────────────────────
BETA_REPO_URL="${BETA_REPO_URL:-https://github.com/hydrospheric0/ebird-rarity-mobile-beta.git}"
BETA_PAGES_BRANCH="gh-pages"
BETA_SOURCE_BRANCH="main"
BETA_REMOTE_NAME="beta"
SOURCE_BRANCH="feat/international"
BETA_VERSION_FILE=".beta-version"   # tracked on feat/international only
DEFAULT_VITE_API_BASE_URL="https://ebird-rarity-mapper.bartwickel.workers.dev"
DEFAULT_UPDATE_MESSAGE="Beta update"
# ──────────────────────────────────────────────────────────────────────────

cd "$(dirname "${BASH_SOURCE[0]}")"

normalize_git_url() {
  local url="$1"
  url="${url%.git}"
  if [[ "$url" =~ ^git@github\.com:(.*)$ ]]; then
    url="https://github.com/${BASH_REMATCH[1]}"
  fi
  echo "$url"
}

ensure_remote_url() {
  local remote_name="$1"
  local expected_url="$2"
  local current_url=""

  if git remote get-url "$remote_name" >/dev/null 2>&1; then
    current_url="$(git remote get-url "$remote_name")"
    if [[ "$(normalize_git_url "$current_url")" != "$(normalize_git_url "$expected_url")" ]]; then
      echo "🔧 Updating remote $remote_name → $expected_url"
      git remote set-url "$remote_name" "$expected_url"
    fi
  else
    echo "🔗 Adding remote $remote_name → $expected_url"
    git remote add "$remote_name" "$expected_url"
  fi
}

# ── Guard: must be on feat/international ─────────────────────────────────
CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$CURRENT_BRANCH" != "feat/international" ]]; then
  echo "❌ ERROR: pushit-beta.sh must be run from the feat/international branch."
  echo "   Current branch: $CURRENT_BRANCH"
  echo "   Run: git checkout feat/international"
  exit 1
fi

# ── Guard: warn if beta repo URL is still the placeholder ────────────────
if [[ "$BETA_REPO_URL" == *"ebird-rarity-mobile-beta.git" ]] && \
   ! git ls-remote "$BETA_REPO_URL" HEAD >/dev/null 2>&1; then
  echo ""
  echo "❌ ERROR: Beta repo not found or not accessible: $BETA_REPO_URL"
  echo ""
  echo "   To fix:"
  echo "   1. Create a new GitHub repo (e.g. ebird-rarity-mobile-beta)"
  echo "   2. Set BETA_REPO_URL in this script or export it in your shell"
  echo "      export BETA_REPO_URL=https://github.com/<you>/<new-repo>.git"
  echo ""
  exit 1
fi

usage() {
  cat <<'EOF'
Usage:
  ./pushit-beta.sh [message]
  ./pushit-beta.sh --release <version> [message]   # e.g. 0.7.0-beta.3

Deploys feat/international to the beta GitHub Pages repo.
Does NOT modify main or the production deploy.
EOF
}

is_valid_beta_version() {
  # Accepts: 0.7.0-beta.N  or  x.y.z  or  x.y.z-tag.N
  [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$ ]]
}

get_current_beta_version() {
  local v=""
  if [[ -f "$BETA_VERSION_FILE" ]]; then
    v="$(tr -d '[:space:]' < "$BETA_VERSION_FILE")"
  fi
  if [[ -z "$v" ]]; then
    v="0.7.0-beta.0"
    echo "$v" > "$BETA_VERSION_FILE"
  fi
  echo "$v"
}

increment_beta_version() {
  local v="$1"
  # Extract N from x.y.z-beta.N  (or x.y.z-beta.N)
  if [[ "$v" =~ ^([0-9]+\.[0-9]+\.[0-9]+)-beta\.([0-9]+)$ ]]; then
    local base="${BASH_REMATCH[1]}"
    local n="${BASH_REMATCH[2]}"
    n=$((n + 1))
    echo "${base}-beta.${n}"
  else
    # Not a beta.N version — append -beta.1
    echo "${v}-beta.1"
  fi
}

# ── arg parsing ─────────────────────────────────────────────────────────────
release_version=""
msg_parts=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --release)
      release_version="${2:-}"
      if [[ -z "$release_version" ]]; then
        echo "ERROR: --release requires a version (e.g., 0.7.0-beta.3)." >&2
        exit 1
      fi
      if ! is_valid_beta_version "$release_version"; then
        echo "ERROR: --release version format invalid: $release_version" >&2
        exit 1
      fi
      shift 2
      ;;
    -h|--help) usage; exit 0 ;;
    --) shift; msg_parts+=("$@"); break ;;
    *) msg_parts+=("$1"); shift ;;
  esac
done

msg="${msg_parts[*]:-$DEFAULT_UPDATE_MESSAGE}"

if [[ -z "${VITE_API_BASE_URL:-}" ]]; then
  export VITE_API_BASE_URL="$DEFAULT_VITE_API_BASE_URL"
  echo "ℹ️  VITE_API_BASE_URL not set. Using: $VITE_API_BASE_URL"
fi

ensure_remote_url "$BETA_REMOTE_NAME" "$BETA_REPO_URL"

current_version="$(get_current_beta_version)"
if [[ -n "$release_version" ]]; then
  next_version="$release_version"
  echo "🏷️  Using explicit beta version: $next_version"
else
  next_version="$(increment_beta_version "$current_version")"
  echo "🏷️  Auto-bumping beta version: $current_version → $next_version"
fi

# Update only the beta version file (leave main VERSION / package.json alone)
printf '%s\n' "$next_version" > "$BETA_VERSION_FILE"

# ── Stamp the service-worker cache name so browsers always pick up new assets ──
sed -i "s|const CACHE_NAME = '[^']*'|const CACHE_NAME = 'rarity-mobile-v${next_version}'|" sw.js

# ── Commit beta version file + any staged changes ────────────────────────
git add "$BETA_VERSION_FILE" sw.js
git add -u   # stage tracked-file changes on feat/international

if ! git diff --cached --quiet; then
  echo "💾 Committing to feat/international: $msg"
  git commit -m "beta: $msg"
else
  echo "ℹ️  No staged source changes to commit."
fi

echo "📤 Pushing feat/international to origin/$SOURCE_BRANCH..."
git push -u origin HEAD:"$SOURCE_BRANCH"

echo "📤 Mirroring beta source to $BETA_REMOTE_NAME/$BETA_SOURCE_BRANCH..."
git push --force "$BETA_REMOTE_NAME" HEAD:"$BETA_SOURCE_BRANCH"

# ── Tag with beta version ─────────────────────────────────────────────────
git fetch --tags origin >/dev/null 2>&1 || true
release_tag="v${next_version}"
if git rev-parse -q --verify "refs/tags/${release_tag}" >/dev/null 2>&1; then
  echo "ℹ️  Tag ${release_tag} already exists — skipping."
else
  echo "🏷️  Tagging: ${release_tag}"
  git tag -a "${release_tag}" -m "Beta release ${next_version}"
fi
git push origin "${release_tag}" 2>/dev/null || echo "ℹ️  Tag push skipped (may already exist remotely)."

# ── Build ─────────────────────────────────────────────────────────────────
echo "🔨 Building with Vite..."
npm run build

# ── Deploy dist/ → beta repo gh-pages ────────────────────────────────────
echo "🚀 Deploying dist/ to beta repo: $BETA_REPO_URL ($BETA_PAGES_BRANCH)..."

DIST_DIR="$(pwd)/dist"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

if git ls-remote --exit-code "$BETA_REPO_URL" "$BETA_PAGES_BRANCH" >/dev/null 2>&1; then
  git clone --depth 1 --branch "$BETA_PAGES_BRANCH" "$BETA_REPO_URL" "$TMP_DIR"
else
  git clone --depth 1 "$BETA_REPO_URL" "$TMP_DIR"
  pushd "$TMP_DIR" >/dev/null
  git checkout --orphan "$BETA_PAGES_BRANCH"
  git rm -rf . >/dev/null 2>&1 || true
  popd >/dev/null
fi

git -C "$TMP_DIR" remote set-url origin "$BETA_REPO_URL"

mkdir -p "$TMP_DIR/assets"
find "$TMP_DIR" -mindepth 1 -maxdepth 1 ! -name '.git' ! -name 'assets' -exec rm -rf {} +
find "$TMP_DIR/assets" -mindepth 1 -maxdepth 1 -exec rm -rf {} +

for entry in "$DIST_DIR"/*; do
  base="$(basename "$entry")"
  [[ "$base" == "assets" ]] && continue
  cp -r "$entry" "$TMP_DIR/"
done

if [[ -d "$DIST_DIR/assets" ]]; then
  cp -r "$DIST_DIR/assets"/. "$TMP_DIR/assets/"
fi

pushd "$TMP_DIR" >/dev/null
git add -A
if ! git diff --cached --quiet; then
  git commit -m "Deploy beta: $msg (${next_version})"
else
  echo "ℹ️  Beta gh-pages content unchanged — nothing to deploy."
  popd >/dev/null
  exit 0
fi
git push --force origin HEAD:"$BETA_PAGES_BRANCH"
popd >/dev/null

BETA_REPO_NAME="$(basename "$BETA_REPO_URL" .git)"
BETA_OWNER="$(echo "$BETA_REPO_URL" | sed 's|.*github.com/||;s|/.*||')"

echo ""
echo "✅ Beta deploy complete!"
echo "   Source   → https://github.com/${BETA_OWNER}/${BETA_REPO_NAME}/tree/$BETA_SOURCE_BRANCH"
echo "   Beta app → https://${BETA_OWNER}.github.io/${BETA_REPO_NAME}/"
echo "   Version  → ${next_version}"
echo ""
echo "   Production (main) is unchanged."
