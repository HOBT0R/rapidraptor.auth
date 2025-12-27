# Version Sync Issue Detected

## Problem

There's a mismatch between your git tags and package.json versions:

- **Latest tag on remote**: `v.0.2.0` (incorrect format - has dot after 'v')
- **Current package.json version**: `0.1.0`
- **Tagged commit version**: `0.1.0` (tag was created but version wasn't bumped)

## Solutions

### Option 1: Update package.json to match the tag (Recommended)

If `v.0.2.0` represents the correct next version:

```bash
# Update all package.json files to 0.2.0
npm run version:bump 0.2.0

# Commit the change
git add package.json packages/*/package.json
git commit -m "chore: sync version to 0.2.0 to match existing tag"
git push origin main
```

### Option 2: Delete the incorrect tag and create correct one

If `v.0.2.0` was created incorrectly:

```bash
# Delete the incorrect tag (both local and remote)
git tag -d v.0.2.0
git push origin :refs/tags/v.0.2.0

# Create correct tag for current version
git tag v0.1.0
git push origin v0.1.0
```

### Option 3: Fix tag format and sync

If you want to keep 0.2.0 but fix the tag format:

```bash
# Update version to 0.2.0
npm run version:bump 0.2.0

# Delete old tag
git tag -d v.0.2.0
git push origin :refs/tags/v.0.2.0

# Create correct tag
git tag v0.2.0
git push origin v0.2.0

# Commit version change
git add package.json packages/*/package.json
git commit -m "chore: sync version to 0.2.0"
git push origin main
```

## Prevention

The GitHub Actions workflow now checks for existing tags before creating releases to prevent this issue.

## Check Status

Run this anytime to check version sync:
```bash
npm run version:sync
```

