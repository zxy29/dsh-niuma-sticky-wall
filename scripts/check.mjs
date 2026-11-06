#!/usr/bin/env node
/**
 * Pre-publish self-check for this bundle.
 *
 * The two names that must agree — the npm package name and the Client module id
 * the browser module loader registers — are easy to break by renaming a file by
 * hand, and a mismatch makes the installed plugin silently fail to render. This
 * script also checks the patch row, the exported resources, locale metadata, the
 * icon, and JavaScript syntax. It has no dependencies and changes nothing.
 *
 *   node scripts/check.mjs      (npm run check)
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const failures = []
const warnings = []

const ok = (message) => console.log('ok      ' + message)
const fail = (message) => {
  failures.push(message)
  console.error('FAIL    ' + message)
}
const warn = (message) => {
  warnings.push(message)
  console.warn('WARN    ' + message)
}

/** Escape one string for literal use inside a RegExp. */
function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Match one `files` entry pattern (`*` spans one path segment) against a path. */
function covers(patterns, file) {
  return patterns.some((pattern) => {
    const source = '^' + pattern.split('*').map(escapeRegExp).join('[^/]*') + '$'
    return new RegExp(source).test(file)
  })
}

// ------------------------------------------------------------- manifest

let pkg
try {
  pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  ok('package.json parses')
} catch (error) {
  fail('package.json cannot be read: ' + error.message)
  console.error('\nSelf-check failed.')
  process.exit(1)
}

const name = typeof pkg.name === 'string' ? pkg.name : ''
if (/^[a-z0-9][a-z0-9._-]*$/.test(name)) ok('npm name "' + name + '" is a plain package name')
else if (/^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/.test(name)) warn('npm name "' + name + '" is scoped; publish with --access public and install by the full name')
else fail('npm name "' + name + '" is not a valid package name')

if (pkg.private === true) fail('"private": true blocks npm publish; remove it before publishing')
else ok('package is publishable ("private" is not true)')

if (pkg.type === 'module') ok('package is ESM ("type": "module")')
else warn('expected "type": "module" for the Host half index.js')

if (typeof pkg.version === 'string' && /^\d+\.\d+\.\d+/.test(pkg.version)) ok('version ' + pkg.version)
else fail('version is missing or not semver')

if (pkg.engines !== undefined && typeof pkg.engines.dsh === 'string' && pkg.engines.dsh !== '') {
  ok('engines.dsh = "' + pkg.engines.dsh + '"')
} else if (pkg.engines !== undefined && typeof pkg.engines.dsh !== 'string') {
  fail('engines.dsh must be a semver range string')
} else {
  warn('no engines.dsh range; every DSH version will accept the bundle')
}

// ------------------------------------------------------------- bundle

const patch = pkg.dsh !== undefined && pkg.dsh.bundle !== undefined ? pkg.dsh.bundle.patch : undefined
if (typeof patch !== 'string') {
  fail('dsh.bundle.patch is missing; the package would install as a plain dependency')
} else {
  const patchPath = join(root, patch)
  if (!existsSync(patchPath)) fail('dsh.bundle.patch points at a missing file: ' + patch)
  else {
    const patchText = readFileSync(patchPath, 'utf8')
    ok('bundle patch exists: ' + patch)
    if (name === '' || !new RegExp('name:\\s*[\'"]?' + escapeRegExp(name) + '[\'"]?\\s*$', 'm').test(patchText)) {
      fail('patch rows must reference the package by its exact name "' + name + '"')
    } else {
      ok('patch row references "' + name + '"')
    }
  }
}

// ------------------------------------------------------------- client half

const clientExport = pkg.exports !== undefined ? pkg.exports['./client'] : undefined
if (typeof clientExport !== 'string') {
  fail('exports["./client"] is missing; DSH would find no browser half')
} else {
  const clientPath = join(root, clientExport.replace(/^\.\//, ''))
  if (!existsSync(clientPath)) {
    fail('exports["./client"] points at a missing file: ' + clientExport)
  } else {
    const clientText = readFileSync(clientPath, 'utf8')
    ok('client half exists: ' + clientExport)
    if (name === '' || !new RegExp('id:\\s*[\'"]' + escapeRegExp(name) + '[\'"]').test(clientText)) {
      fail('client module id must equal the package name "' + name + '" (the module loader id)')
    } else {
      ok('client module id equals the package name')
    }
    if (/require\(\s*['"]@deepseek-ai\/dsh-client-/.test(clientText)) {
      fail('client half must not import another DSH Client package')
    } else {
      ok('client half imports no DSH Client package')
    }
  }
}

const clientConfig = pkg.dsh !== undefined ? pkg.dsh.client : undefined
if (clientConfig === undefined || clientConfig === null) fail('dsh.client is missing; the browser half would never load')
else {
  if (clientConfig.platform === 'web') ok('dsh.client.platform = web')
  else warn('dsh.client.platform is not "web"')
  if (Array.isArray(clientConfig.inject) && clientConfig.inject.length > 0) ok('dsh.client.inject declares ' + clientConfig.inject.length + ' activation rows')
  else warn('dsh.client.inject is empty; activation order is left to chance')
}

// ------------------------------------------------------------- resources

const iconExport = pkg.exports !== undefined ? pkg.exports['./icon'] : undefined
if (typeof iconExport !== 'string') fail('exports["./icon"] is missing; the plugin list would show default artwork')
else {
  const iconPath = join(root, iconExport.replace(/^\.\//, ''))
  if (!existsSync(iconPath)) fail('exports["./icon"] points at a missing file: ' + iconExport)
  else {
    const size = statSync(iconPath).size
    if (size > 256 * 1024) fail('icon is ' + size + ' bytes; the limit is 262144')
    else ok('icon exists (' + size + ' bytes)')
    if (iconPath.endsWith('.svg') && !readFileSync(iconPath, 'utf8').trimStart().startsWith('<svg')) {
      fail('icon.svg does not start with <svg')
    }
  }
}

for (const locale of ['en', 'zh']) {
  let dict
  try {
    dict = JSON.parse(readFileSync(join(root, 'locale', locale + '.json'), 'utf8'))
  } catch {
    fail('locale/' + locale + '.json is missing or malformed')
    continue
  }
  const meta = dict.meta !== undefined ? dict.meta : {}
  if (typeof meta.title === 'string' && meta.title !== '' && typeof meta.description === 'string' && meta.description !== '') {
    ok('locale/' + locale + '.json has meta.title and meta.description')
  } else {
    fail('locale/' + locale + '.json needs meta.title and meta.description')
  }
}

// The published file list must carry every runtime file.
const files = Array.isArray(pkg.files) ? pkg.files : []
if (files.length === 0) fail('"files" is missing; the tarball would contain the whole checkout')
else {
  for (const required of ['index.js', 'client.js', 'cordis.patch.yml', 'locale/en.json', 'locale/zh.json', 'icon.svg']) {
    if (covers(files, required)) ok('files includes ' + required)
    else fail('"files" does not include ' + required)
  }
}

// ------------------------------------------------------------- syntax

const scripts = readdirSync(root).filter((file) => file.endsWith('.js'))
for (const file of scripts) {
  try {
    execFileSync(process.execPath, ['--check', join(root, file)], { stdio: 'pipe' })
    ok('syntax: ' + file)
  } catch (error) {
    fail('syntax error in ' + file + ': ' + String(error.stderr || error.message).trim().split('\n')[0])
  }
}

// ------------------------------------------------------------- polish

if (existsSync(join(root, 'README.md'))) ok('README.md present')
else warn('README.md is missing; npm would publish a package page without usage notes')
if (existsSync(join(root, 'LICENSE'))) ok('LICENSE present')
else warn('LICENSE is missing while the manifest declares a license')

if (JSON.stringify(pkg).includes('YOUR_GITHUB_USER')) {
  warn('package.json still contains YOUR_GITHUB_USER; run: node scripts/set-owner.mjs <github-user>')
}

console.log('')
if (failures.length > 0) {
  console.error('Self-check failed: ' + failures.length + ' problem(s), ' + warnings.length + ' warning(s).')
  process.exit(1)
}
console.log('Self-check passed: ' + warnings.length + ' warning(s).')
