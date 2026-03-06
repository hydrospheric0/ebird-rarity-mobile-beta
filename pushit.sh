#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# pushit.sh — build + deploy mobile_rarity_mapper to GitHub Pages
#
# Usage:
#   ./pushit.sh [message]
#   ./pushit.sh --all [message]       # include untracked source files
#   ./pushit.sh --release <version> [message]  # explicit version override
#
# GitHub Pages is served from the gh-pages branch (root of that branch).
# Source lives on main. dist/ is kept out of the source tree (.gitignore).
# ---------------------------------------------------------------------------

REPO_URL="https://github.com/hydrospheric0/ebird-rarity-mobile.git"
PAGES_BRANCH="gh-pages"
SOURCE_BRANCH="main"
DEFAULT_VITE_API_BASE_URL="https://ebird-rarity-mapper.bartwickel.workers.dev"
DEFAULT_UPDATE_MESSAGE="Minor updates"

cd "$(dirname "${BASH_SOURCE[0]}")"

usage() {
  cat <<'EOF'
Usage:
  ./pushit.sh [message]
  ./pushit.sh --all [message]
  ./pushit.sh --release <version> [message]

Options:
  --all   Stage all files including untracked (git add -A). Default stages
          only already-tracked files (git add -u).
  --release <version>
          Set an explicit version (e.g., 0.0.7) instead of auto-bumping.
  -h      Show this help.

The script will:
  0. Auto-bump patch version by default (+0.0.1, i.e. x.y.z -> x.y.(z+1)).
  1. Init git and wire up the remote if this is the first run.
  2. Stage + commit source changes to main.
  3. Create and push a git tag (vX.Y.Z) for the release.
  4. Run `npm run build` (Vite).
  5. Force-push the built dist/ contents to the gh-pages branch.
EOF
}

is_valid_semver() {
  [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]
}

get_current_version() {
  local v=""
  if [[ -f VERSION ]]; then
    v="$(tr -d '[:space:]' < VERSION)"
  fi
  if [[ -z "$v" && -f package.json ]]; then
    v="$(node -e "const fs=require('fs');const j=JSON.parse(fs.readFileSync('package.json','utf8'));process.stdout.write(String(j.version||''));")"
  fi
  if ! is_valid_semver "$v"; then
    echo "ERROR: Could not determine a valid current version (expected x.y.z)." >&2
    exit 1
  fi
  echo "$v"
}

increment_patch_version() {
  local v="$1"
  IFS='.' read -r major minor patch <<< "$v"
  patch=$((patch + 1))
  echo "${major}.${minor}.${patch}"
}

set_version_files() {
  local next_version="$1"
  printf '%s\n' "$next_version" > VERSION

  node -e "
const fs=require('fs');
const next=process.argv[1];
const pkgPath='package.json';
const lockPath='package-lock.json';

const pkg=JSON.parse(fs.readFileSync(pkgPath,'utf8'));
pkg.version=next;
fs.writeFileSync(pkgPath, JSON.stringify(pkg,null,2)+'\\n');

if (fs.existsSync(lockPath)) {
  const lock=JSON.parse(fs.readFileSync(lockPath,'utf8'));
  lock.version=next;
  if (lock.packages && lock.packages['']) {
    lock.packages[''].version=next;
  }
  fs.writeFileSync(lockPath, JSON.stringify(lock,null,2)+'\\n');
}
" "$next_version"
}

# ── arg parsing ─────────────────────────────────────────────────────────────
stage_mode="tracked"
release_version=""
msg_parts=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --all) stage_mode="all"; shift ;;
    --release)
      release_version="${2:-}"
      if [[ -z "$release_version" ]]; then
        echo "ERROR: --release requires a version (e.g., 0.0.7)." >&2
        exit 1
      fi
      if ! is_valid_semver "$release_version"; then
        echo "ERROR: --release must be in x.y.z format (e.g., 0.0.7)." >&2
        exit 1
      fi
      shift 2
      ;;
    -h|--help) usage; exit 0 ;;
    --) shift; msg_parts+=("$@"); break ;;
    *) msg_parts+=("$1"); shift ;;
  esac
done

msg="${msg_parts[*]:-}"
if [[ -z "$msg" ]]; then
  msg="$DEFAULT_UPDATE_MESSAGE"
fi

if [[ -z "${VITE_API_BASE_URL:-}" ]]; then
  export VITE_API_BASE_URL="$DEFAULT_VITE_API_BASE_URL"
  echo "ℹ️  VITE_API_BASE_URL not set. Using default: $VITE_API_BASE_URL"
fi

current_version="$(get_current_version)"
if [[ -n "$release_version" ]]; then
  next_version="$release_version"
  echo "🏷️  Using explicit version: $next_version"
else
  next_version="$(increment_patch_version "$current_version")"
  echo "🏷️  Auto-bumping version (+0.0.1): $current_version → $next_version"
fi
set_version_files "$next_version"

# ── 1. Ensure git repo exists ────────────────────────────────────────────────
if [ ! -d ".git" ]; then
  echo "📦 Initialising git repository..."
  git init
  git branch -M "$SOURCE_BRANCH"
fi

# ── 2. Wire up remote if missing ─────────────────────────────────────────────
if ! git remote get-url origin >/dev/null 2>&1; then
  echo "🔗 Adding remote origin → $REPO_URL"
  git remote add origin "$REPO_URL"
fi

# ── 3. Stage + commit source ─────────────────────────────────────────────────
if [[ "$stage_mode" == "all" ]]; then
  git add -A
else
  git add -u
fi

if ! git diff --cached --quiet; then
  echo "💾 Committing source: $msg"
  git commit -m "$msg"
else
  echo "ℹ️  No staged source changes to commit."
fi

# Pull/rebase so we don't diverge (skip on first push when no upstream yet)
if git rev-parse --verify -q "origin/$SOURCE_BRANCH" >/dev/null 2>&1; then
  git pull --rebase origin "$SOURCE_BRANCH"
fi

echo "📤 Pushing source to origin/$SOURCE_BRANCH..."
git push -u origin "$SOURCE_BRANCH"

# ── 4. Tag release ─────────────────────────────────────────────────────────
git fetch --tags origin >/dev/null 2>&1 || true
release_tag="v${next_version}"
if git rev-parse -q --verify "refs/tags/${release_tag}" >/dev/null 2>&1; then
  echo "ℹ️  Tag ${release_tag} already exists — skipping tag creation."
else
  echo "🏷️  Tagging release: ${release_tag}"
  git tag -a "${release_tag}" -m "Release ${next_version}"
fi
echo "📤 Pushing tag ${release_tag}..."
git push origin "${release_tag}"

# ── 5. Build ─────────────────────────────────────────────────────────────────
echo "🔨 Building with Vite..."
npm run build

# ── 6. Deploy dist/ → gh-pages ───────────────────────────────────────────────
echo "🚀 Deploying dist/ to $PAGES_BRANCH..."

DIST_DIR="$(pwd)/dist"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

# Clone just the gh-pages branch into a temp dir (shallow, or fresh if new)
if git ls-remote --exit-code origin "$PAGES_BRANCH" >/dev/null 2>&1; then
  git clone --depth 1 --branch "$PAGES_BRANCH" "$REPO_URL" "$TMP_DIR"
else
  # First deploy: init empty branch
  git clone --depth 1 "$REPO_URL" "$TMP_DIR"
  pushd "$TMP_DIR" >/dev/null
  git checkout --orphan "$PAGES_BRANCH"
  git rm -rf . >/dev/null 2>&1 || true
  popd >/dev/null
fi

# Wire remote on the temp clone to point at GitHub (not local)
git -C "$TMP_DIR" remote set-url origin "$REPO_URL"

# Replace old gh-pages contents so stale hashed assets do not linger.
mkdir -p "$TMP_DIR/assets"
find "$TMP_DIR" -mindepth 1 -maxdepth 1 ! -name '.git' ! -name 'assets' -exec rm -rf {} +
find "$TMP_DIR/assets" -mindepth 1 -maxdepth 1 -exec rm -rf {} +

# Copy top-level dist files (excluding assets/) fresh.
for entry in "$DIST_DIR"/*; do
  base="$(basename "$entry")"
  if [[ "$base" == "assets" ]]; then
    continue
  fi
  cp -r "$entry" "$TMP_DIR/"
done

# Copy fresh hashed assets.
if [[ -d "$DIST_DIR/assets" ]]; then
  cp -r "$DIST_DIR/assets"/. "$TMP_DIR/assets/"
fi

# Commit + force-push
pushd "$TMP_DIR" >/dev/null
git add -A
if ! git diff --cached --quiet; then
  git commit -m "Deploy: $msg"
else
  echo "ℹ️  gh-pages content identical — nothing new to deploy."
  popd >/dev/null
  exit 0
fi
git push --force origin HEAD:"$PAGES_BRANCH"
popd >/dev/null

echo ""
echo "✅ Done!"
echo "   Source  → https://github.com/hydrospheric0/ebird-rarity-mobile/tree/$SOURCE_BRANCH"
echo "   Live    → https://hydrospheric0.github.io/ebird-rarity-mobile/"
echo "   (GitHub Pages may take a minute or two to update.)"
