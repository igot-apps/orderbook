#!/usr/bin/env bash
# Build the frontend for GitHub Pages and publish it to the gh-pages branch.
# Usage (from frontend/):  VITE_API_URL=https://your-api.example.com/api npm run deploy:pages
set -euo pipefail
cd "$(dirname "$0")/.."

REMOTE_URL="$(git -C .. remote get-url origin)"
REPO_NAME="$(basename -s .git "$REMOTE_URL")"

npx tsc -b
MSYS_NO_PATHCONV=1 npx vite build --mode github --base="/${REPO_NAME}/"
cp dist/index.html dist/404.html
touch dist/.nojekyll

# Keep the previous build's files so browsers still holding the old index.html don't get a blank page.
prev="$(mktemp -d)"
if git clone -q --depth 1 -b gh-pages "$REMOTE_URL" "$prev" 2>/dev/null && [ -d "$prev/assets" ]; then
  cp -n "$prev"/assets/* dist/assets/ 2>/dev/null || true
fi
rm -rf "$prev"

cd dist
rm -rf .git
git init -q -b gh-pages
git add -A
git -c user.name="OrderBook Deploy" -c user.email="deploy@users.noreply.github.com" commit -q -m "Deploy to GitHub Pages"
git push -f -q "$REMOTE_URL" gh-pages
rm -rf .git
echo "Deployed to https://$(echo "$REMOTE_URL" | sed -E 's#.*github.com[:/]([^/]+)/.*#\1#').github.io/${REPO_NAME}/"
