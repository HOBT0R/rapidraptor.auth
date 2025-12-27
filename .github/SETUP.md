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

## npm Publishing Setup

This project uses npm's **Trusted Publishing** feature to automatically publish packages to npmjs.com after releases are created. This eliminates the need for long-lived npm tokens.

### Prerequisites

1. **Create npm Organization** (if it doesn't exist):
   - Go to https://www.npmjs.com/org/create
   - Create an organization named `rapidraptor`
   - The scope `@rapidraptor` will be available for your organization

2. **Initial Manual Publish** (one-time only):
   - Packages must exist on npm before Trusted Publishing can be configured
   - Log in to npm: `npm login`
   - Build packages: `npm run build`
   - Publish: `node scripts/publish.js`
   - Verify packages are published on npmjs.com

### Configure Trusted Publishing

After the initial publish, configure Trusted Publishing for each package:

1. **For each package** (`@rapidraptor/auth-shared`, `@rapidraptor/auth-client`, `@rapidraptor/auth-server`):
   - Go to the package's Settings page on npmjs.com
   - Find the "Trusted Publishers" section
   - Click "Add Trusted Publisher"
   - Select "GitHub Actions"
   - Provide:
     - **Organization or User**: Your GitHub username or organization (e.g., `HOBT0R`)
     - **Repository**: `rapidraptor.auth` (or your actual repo name)
     - **Workflow Filename**: `release.yml`
   - Click "Set up connection"

2. **Verify setup**:
   - The workflow already has `id-token: write` permission (required for OIDC)
   - The workflow uses `actions/setup-node@v4` with `registry-url: 'https://registry.npmjs.org'` (enables OIDC)
   - Packages are published with `--provenance` flag for enhanced security

### How It Works

1. When a release is created (via the release workflow), packages are automatically:
   - Built
   - Published to npmjs.com in the correct order (shared → client → server)
   - Published with provenance statements linking to the GitHub repository

2. **No secrets required**: Trusted Publishing uses OpenID Connect (OIDC) for authentication, eliminating the need for npm tokens.

### Benefits

- ✅ No long-lived tokens to manage or rotate
- ✅ More secure (uses OpenID Connect)
- ✅ Automatically authenticated via GitHub Actions
- ✅ Supports provenance statements for supply chain security

### Troubleshooting

**Publishing fails with "Scope not found"**:
- Ensure the npm organization `rapidraptor` exists
- Verify you're logged in as a member of that organization

**Publishing fails with authentication errors**:
- Verify Trusted Publishing is configured for each package
- Check that the workflow filename matches (`release.yml`)
- Ensure the repository name matches your GitHub repository

**Packages not publishing automatically**:
- Check that packages exist on npm (initial manual publish completed)
- Verify Trusted Publishing is configured for all three packages
- Check workflow logs in the Actions tab for error messages

