#!/bin/bash

# Create Initial Release Script
# Creates the initial v0.1.0 tag and GitHub release

set -e

VERSION="0.1.0"
TAG="v${VERSION}"

echo "🚀 Creating initial release ${TAG}..."

# Check if tag already exists
if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "❌ Tag ${TAG} already exists!"
  exit 1
fi

# Verify versions are synchronized
echo "📋 Verifying versions..."
npm run version:check

# Build all packages
echo "🔨 Building packages..."
npm run build

# Create and push tag
echo "🏷️  Creating tag ${TAG}..."
git tag -a "${TAG}" -m "Release ${TAG} - Initial release"
git push origin "${TAG}"

echo "✅ Tag ${TAG} created and pushed!"
echo ""
echo "📝 Next steps:"
echo "   1. Go to https://github.com/$(git config --get remote.origin.url | sed 's/.*github.com[:/]\(.*\)\.git/\1/')/releases/new"
echo "   2. Select tag: ${TAG}"
echo "   3. Title: Release ${TAG}"
echo "   4. Description: Initial release of @rapidraptor/auth library"
echo "   5. Click 'Publish release'"
echo ""
echo "Or use GitHub CLI:"
echo "   gh release create ${TAG} --title 'Release ${TAG}' --notes 'Initial release of @rapidraptor/auth library'"






