#!/usr/bin/env node

/**
 * Version Check Script
 * 
 * Validates that all packages have synchronized versions.
 * 
 * Usage:
 *   node scripts/version-check.js
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

const PACKAGES = [
  { name: 'root', path: 'package.json' },
  { name: 'shared', path: 'packages/shared/package.json' },
  { name: 'client', path: 'packages/client/package.json' },
  { name: 'server', path: 'packages/server/package.json' },
];

function readPackageJson(path) {
  const content = readFileSync(path, 'utf-8');
  return JSON.parse(content);
}

function main() {
  const versions = {};
  const versionSet = new Set();
  
  for (const { name, path } of PACKAGES) {
    const fullPath = join(rootDir, path);
    const packageData = readPackageJson(fullPath);
    versions[name] = packageData.version;
    versionSet.add(packageData.version);
  }
  
  if (versionSet.size !== 1) {
    console.error('❌ Versions are not synchronized:');
    for (const [name, version] of Object.entries(versions)) {
      console.error(`  ${name}: ${version}`);
    }
    process.exit(1);
  } else {
    const version = Array.from(versionSet)[0];
    console.log(`✅ All versions synchronized: ${version}`);
  }
}

main();






