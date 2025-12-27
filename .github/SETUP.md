# GitHub Actions Setup Guide

## Automatic Setup

GitHub Actions should work automatically with the default `GITHUB_TOKEN` that GitHub provides. No additional setup is required!

## Permissions

The release workflow requires:
- **Contents: write** - To push commits and tags back to the repository
- **id-token: write** - For authentication (automatically provided)

These permissions are already configured in `.github/workflows/release.yml`.

## How It Works

1. **GITHUB_TOKEN** is automatically created by GitHub for each workflow run
2. The token has permissions to:
   - Read repository contents
   - Write commits and tags
   - Push to the repository

## Verification

To verify the workflow is set up correctly:

1. Go to your repository on GitHub
2. Click **Settings** → **Actions** → **General**
3. Under **Workflow permissions**, ensure:
   - ✅ "Read and write permissions" is selected
   - ✅ "Allow GitHub Actions to create and approve pull requests" is checked (if you want PR creation)

## Troubleshooting

### Workflow doesn't run
- Check that GitHub Actions are enabled: **Settings** → **Actions** → **General** → "Allow all actions and reusable workflows"
- Verify the workflow file is in `.github/workflows/` directory
- Check that you're pushing to the `main` branch

### Permission denied errors
- Ensure **Workflow permissions** allows "Read and write permissions"
- The `GITHUB_TOKEN` should have `contents: write` permission (already configured)

### Release not created
- Check workflow logs in **Actions** tab
- Verify commit messages follow conventional commit format (`feat:`, `fix:`, etc.)
- Ensure the last commit isn't already a release commit

## Manual Token (Not Required)

If you need a personal access token (not recommended, GITHUB_TOKEN works fine):

1. Go to **Settings** → **Developer settings** → **Personal access tokens** → **Tokens (classic)**
2. Create token with `repo` scope
3. Add as secret: **Settings** → **Secrets and variables** → **Actions** → **New repository secret**
4. Name it `GH_TOKEN` and update workflow to use `${{ secrets.GH_TOKEN }}`

**Note**: The default `GITHUB_TOKEN` is sufficient for this workflow.

