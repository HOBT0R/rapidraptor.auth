#!/usr/bin/env node

/**
 * Publish Script
 * 
 * Publishes all packages to npm in the correct order.
 * 
 * Usage:
 *   node scripts/publish.js
 */

import { execSync } from 'child_process';
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

function publishPackage(packagePath) {
  const fullPath = join(rootDir, packagePath);
  console.log(`\n📦 Publishing ${packagePath}...`);
  try {
    execSync('npm publish --access public', {
      cwd: fullPath,
      stdio: 'inherit',
    });
    console.log(`✅ Successfully published ${packagePath}`);
  } catch (error) {
    console.error(`❌ Failed to publish ${packagePath}`);
    throw error;
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
  
  // Publish packages in order
  for (const packagePath of PACKAGES) {
    publishPackage(packagePath);
  }
  
  console.log('\n🎉 All packages published successfully!');
}

main();

