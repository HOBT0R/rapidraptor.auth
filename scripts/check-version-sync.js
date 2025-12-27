#!/usr/bin/env node

/**
 * Version Sync Check Script
 * 
 * Checks if package.json versions are in sync with git tags.
 * 
 * Usage:
 *   node scripts/check-version-sync.js
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

function readPackageJson(path) {
  const content = readFileSync(path, 'utf-8');
  return JSON.parse(content);
}

function getGitTags() {
  try {
    const allTags = execSync('git tag -l "v*"', { cwd: rootDir, encoding: 'utf-8' })
      .trim()
      .split('\n')
      .filter(tag => tag.length > 0);
    
    // Parse tags and extract version numbers
    const tags = allTags.map(tag => {
      // Handle both "v0.2.0" and "v.0.2.0" formats
      const version = tag.replace(/^v\.?/, ''); // Remove 'v' or 'v.' prefix
      return { tag, version };
    })
    .filter(({ version }) => /^\d+\.\d+\.\d+$/.test(version)) // Only valid semver
    .sort((a, b) => {
      const aParts = a.version.split('.').map(Number);
      const bParts = b.version.split('.').map(Number);
      for (let i = 0; i < 3; i++) {
        if (aParts[i] !== bParts[i]) {
          return aParts[i] - bParts[i];
        }
      }
      return 0;
    });
    
    return tags;
  } catch (error) {
    return [];
  }
}


function main() {
  console.log('🔍 Checking version synchronization...\n');
  
  // Check package versions
  const rootPackage = readPackageJson(join(rootDir, 'package.json'));
  const sharedPackage = readPackageJson(join(rootDir, 'packages/shared/package.json'));
  const clientPackage = readPackageJson(join(rootDir, 'packages/client/package.json'));
  const serverPackage = readPackageJson(join(rootDir, 'packages/server/package.json'));
  
  const versions = {
    root: rootPackage.version,
    shared: sharedPackage.version,
    client: clientPackage.version,
    server: serverPackage.version,
  };
  
  // Check if all package versions match
  const versionSet = new Set(Object.values(versions));
  if (versionSet.size !== 1) {
    console.error('❌ Package versions are not synchronized:');
    for (const [name, version] of Object.entries(versions)) {
      console.error(`  ${name}: ${version}`);
    }
    process.exit(1);
  }
  
  const currentVersion = Array.from(versionSet)[0];
  console.log(`✅ All package versions synchronized: ${currentVersion}\n`);
  
  // Check git tags
  const tagData = getGitTags();
  const tagVersions = tagData.map(t => t.version);
  const latestTagData = tagData.length > 0 ? tagData[tagData.length - 1] : null;
  
  if (tagData.length > 0) {
    const tagList = tagData.map(t => t.tag).join(', ');
    console.log(`📋 Git tags found: ${tagList}`);
    
    // Check for malformed tags
    const malformedTags = tagData.filter(t => !t.tag.match(/^v\d+\.\d+\.\d+$/));
    if (malformedTags.length > 0) {
      console.log(`\n⚠️  Malformed tags detected (should be vX.Y.Z format):`);
      malformedTags.forEach(t => {
        console.log(`   - ${t.tag} (should be v${t.version})`);
      });
    }
  } else {
    console.log(`📋 Git tags found: none`);
  }
  
  if (latestTagData) {
    const latestVersion = latestTagData.version;
    const latestTag = latestTagData.tag;
    console.log(`🏷️  Latest tag: ${latestTag} (version: ${latestVersion})`);
    
    if (latestVersion === currentVersion) {
      console.log(`✅ Latest tag version (${latestVersion}) matches current version (${currentVersion})`);
      if (!latestTag.match(/^v\d+\.\d+\.\d+$/)) {
        console.log(`⚠️  Tag format is incorrect (${latestTag}), should be v${latestVersion}`);
      }
    } else {
      console.log(`⚠️  Latest tag version (${latestVersion}) does NOT match current version (${currentVersion})`);
      console.log(`\n   This could mean:`);
      console.log(`   - Version was bumped but tag not created yet`);
      console.log(`   - Tag exists for a different version`);
      console.log(`\n   To fix:`);
      if (tagVersions.includes(currentVersion)) {
        const existingTag = tagData.find(t => t.version === currentVersion);
        console.log(`   - Tag for ${currentVersion} exists: ${existingTag.tag}`);
        if (existingTag.tag !== `v${currentVersion}`) {
          console.log(`   - Fix tag format: git tag -d ${existingTag.tag} && git tag v${currentVersion}`);
        }
      } else {
        console.log(`   - Create tag: git tag v${currentVersion}`);
        console.log(`   - Or bump version to match tag: npm run version:bump ${latestVersion}`);
      }
    }
  } else {
    console.log(`⚠️  No git tags found`);
    console.log(`\n   To create initial tag:`);
    console.log(`   git tag v${currentVersion}`);
  }
  
  console.log('');
}

main();

