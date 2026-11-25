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

cd dist
rm -rf .git
git init -q -b gh-pages
git add -A
git -c user.name="OrderBook Deploy" -c user.email="deploy@users.noreply.github.com" commit -q -m "Deploy to GitHub Pages"
git push -f -q "$REMOTE_URL" gh-pages
rm -rf .git
echo "Deployed to https://$(echo "$REMOTE_URL" | sed -E 's#.*github.com[:/]([^/]+)/.*#\1#').github.io/${REPO_NAME}/"
