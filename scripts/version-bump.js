#!/usr/bin/env node

/**
 * Version Bump Script
 * 
 * Synchronizes version numbers across all packages in the monorepo.
 * Supports major, minor, patch, or specific version.
 * 
 * Usage:
 *   node scripts/version-bump.js patch
 *   node scripts/version-bump.js minor
 *   node scripts/version-bump.js major
 *   node scripts/version-bump.js 1.2.3
 */

import { readFileSync, writeFileSync } from 'fs';
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
 * Increment version based on type
 */
function incrementVersion(currentVersion, type) {
  const { major, minor, patch } = parseVersion(currentVersion);
  
  switch (type) {
    case 'major':
      return `${major + 1}.0.0`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'patch':
      return `${major}.${minor}.${patch + 1}`;
    default:
      // Assume it's a specific version
      if (!/^\d+\.\d+\.\d+$/.test(type)) {
        throw new Error(`Invalid version type: ${type}. Use major, minor, patch, or x.y.z`);
      }
      return type;
  }
}

/**
 * Validate version format
 */
function validateVersion(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`Invalid version format: ${version}. Must be x.y.z (e.g., 1.2.3)`);
  }
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
  const versionType = process.argv[2];
  
  if (!versionType) {
    console.error('Usage: node scripts/version-bump.js <major|minor|patch|version>');
    process.exit(1);
  }

  // Read root package.json to get current version
  const rootPackagePath = join(rootDir, 'package.json');
  const rootPackage = readPackageJson(rootPackagePath);
  const currentVersion = rootPackage.version;
  
  // Calculate new version
  const newVersion = incrementVersion(currentVersion, versionType);
  validateVersion(newVersion);
  
  console.log(`Bumping version from ${currentVersion} to ${newVersion}`);
  
  // Update all package.json files
  for (const packagePath of PACKAGES) {
    const fullPath = join(rootDir, packagePath);
    const packageData = readPackageJson(fullPath);
    packageData.version = newVersion;
    writePackageJson(fullPath, packageData);
    console.log(`  Updated ${packagePath}`);
  }
  
  console.log(`\nVersion bumped successfully to ${newVersion}`);
}

main();






