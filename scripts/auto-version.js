#!/usr/bin/env node

/**
 * Auto Version Script for CI
 * 
 * Automatically bumps the patch version and commits the changes.
 * Used by GitHub Actions release workflow.
 * 
 * Usage:
 *   node scripts/auto-version.js
 */

import { readFileSync, writeFileSync, appendFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

const PACKAGES = [
  'package.json',
  'packages/shared/package.json',
  'packages/client/package.json',
  'packages/server/package.json',
];

/**
 * Parse semantic version string
 */
function parseVersion(version) {
  const parts = version.split('.').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) {
    throw new Error(`Invalid version format: ${version}`);
  }
  return { major: parts[0], minor: parts[1], patch: parts[2] };
}

/**
 * Increment patch version
 */
function incrementPatchVersion(currentVersion) {
  const { major, minor, patch } = parseVersion(currentVersion);
  return `${major}.${minor}.${patch + 1}`;
}

/**
 * Read and parse package.json
 */
function readPackageJson(path) {
  const content = readFileSync(path, 'utf-8');
  return JSON.parse(content);
}

/**
 * Write package.json
 */
function writePackageJson(path, data) {
  const content = JSON.stringify(data, null, 2) + '\n';
  writeFileSync(path, content, 'utf-8');
}

/**
 * Main function
 */
function main() {
  try {
    // Read root package.json to get current version
    const rootPackagePath = join(rootDir, 'package.json');
    const rootPackage = readPackageJson(rootPackagePath);
    const currentVersion = rootPackage.version;
    
    // Calculate new version (patch increment)
    const newVersion = incrementPatchVersion(currentVersion);
    
    console.log(`Bumping version from ${currentVersion} to ${newVersion}`);
    
    // Update all package.json files
    for (const packagePath of PACKAGES) {
      const fullPath = join(rootDir, packagePath);
      const packageData = readPackageJson(fullPath);
      packageData.version = newVersion;
      writePackageJson(fullPath, packageData);
      console.log(`  Updated ${packagePath}`);
    }
    
    // Output the new version for GitHub Actions to use (using GITHUB_OUTPUT)
    const githubOutput = process.env.GITHUB_OUTPUT;
    if (githubOutput) {
      const content = `new_version=${newVersion}\nversion_tag=v${newVersion}\n`;
      appendFileSync(githubOutput, content);
    }
    
    // Also output to stdout for logging
    console.log(`NEW_VERSION=${newVersion}`);
    console.log(`VERSION_TAG=v${newVersion}`);
    
    console.log(`\nVersion bumped successfully to ${newVersion}`);
  } catch (error) {
    console.error('Error bumping version:', error.message);
    process.exit(1);
  }
}

main();

