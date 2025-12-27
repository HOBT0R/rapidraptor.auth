#!/usr/bin/env node

/**
 * Publish Script
 * 
 * Publishes all packages to npm in the correct order.
 * Handles local file dependencies by temporarily replacing them with npm package references.
 * 
 * Usage:
 *   node scripts/publish.js
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

const PACKAGES = [
  'packages/shared',
  'packages/client',
  'packages/server',
];

// Packages that depend on shared (need dependency resolution)
const PACKAGES_WITH_LOCAL_DEPS = [
  'packages/client',
  'packages/server',
];

/**
 * Read and parse package.json
 */
function readPackageJson(packagePath) {
  const fullPath = join(rootDir, packagePath, 'package.json');
  const content = readFileSync(fullPath, 'utf-8');
  return JSON.parse(content);
}

/**
 * Write package.json
 */
function writePackageJson(packagePath, data) {
  const fullPath = join(rootDir, packagePath, 'package.json');
  const content = JSON.stringify(data, null, 2) + '\n';
  writeFileSync(fullPath, content, 'utf-8');
}

/**
 * Get current version from shared package
 */
function getSharedVersion() {
  const sharedPackage = readPackageJson('packages/shared');
  return sharedPackage.version;
}

/**
 * Replace file:../shared dependencies with npm package references
 */
function resolveDependencies(packagePath) {
  const packageData = readPackageJson(packagePath);
  const sharedVersion = getSharedVersion();
  
  if (packageData.dependencies && packageData.dependencies['@rapidraptor/auth-shared'] === 'file:../shared') {
    packageData.dependencies['@rapidraptor/auth-shared'] = `^${sharedVersion}`;
    writePackageJson(packagePath, packageData);
    console.log(`  ✓ Resolved dependency: @rapidraptor/auth-shared@^${sharedVersion}`);
    return true;
  }
  
  return false;
}

/**
 * Restore file:../shared dependencies
 */
function restoreDependencies(packagePath) {
  const packageData = readPackageJson(packagePath);
  
  if (packageData.dependencies && packageData.dependencies['@rapidraptor/auth-shared']?.startsWith('^')) {
    packageData.dependencies['@rapidraptor/auth-shared'] = 'file:../shared';
    writePackageJson(packagePath, packageData);
    console.log(`  ✓ Restored dependency: @rapidraptor/auth-shared@file:../shared`);
    return true;
  }
  
  return false;
}

function publishPackage(packagePath, useProvenance = false) {
  const fullPath = join(rootDir, packagePath);
  console.log(`\n📦 Publishing ${packagePath}...`);
  
  // Resolve dependencies if needed
  if (PACKAGES_WITH_LOCAL_DEPS.includes(packagePath)) {
    resolveDependencies(packagePath);
  }
  
  try {
    const publishCmd = useProvenance 
      ? 'npm publish --access public --provenance'
      : 'npm publish --access public';
    
    execSync(publishCmd, {
      cwd: fullPath,
      stdio: 'inherit',
    });
    console.log(`✅ Successfully published ${packagePath}`);
  } catch (error) {
    console.error(`❌ Failed to publish ${packagePath}`);
    throw error;
  } finally {
    // Always restore dependencies, even on failure
    if (PACKAGES_WITH_LOCAL_DEPS.includes(packagePath)) {
      restoreDependencies(packagePath);
    }
  }
}

function main() {
  console.log('🚀 Starting publication process...\n');
  
  // Check if logged in
  try {
    execSync('npm whoami', { stdio: 'pipe' });
  } catch (error) {
    console.error('❌ Not logged in to npm. Please run: npm login');
    process.exit(1);
  }
  
  // Check if --provenance flag should be used (for Trusted Publishing)
  const useProvenance = process.argv.includes('--provenance');
  
  // Store original states for restoration on error
  const originalStates = new Map();
  
  try {
    // Publish packages in order
    for (const packagePath of PACKAGES) {
      publishPackage(packagePath, useProvenance);
    }
    
    console.log('\n🎉 All packages published successfully!');
  } catch (error) {
    console.error('\n❌ Publication failed. Restoring dependencies...');
    
    // Restore all dependencies on error
    for (const packagePath of PACKAGES_WITH_LOCAL_DEPS) {
      restoreDependencies(packagePath);
    }
    
    process.exit(1);
  }
}

main();

