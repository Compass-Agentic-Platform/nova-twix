/**
 * update-hashes.js
 *
 * Two operating modes:
 *
 * ── LOCAL MODE (developer workflow) ─────────────────────────────────────────
 * Reads latest.json, locates each platform's binary in a given directory,
 * computes its SHA-256 hash and byte size, then writes the updated values
 * back into latest.json.
 *
 * Usage:
 *   node scripts/update-hashes.js --dir <path-to-release-binaries> [--json <manifest>]
 *
 * Options:
 *   --dir   Directory containing the release binary files (required)
 *   --json  Path to the JSON manifest to update (default: latest.json)
 *
 * Example:
 *   node scripts/update-hashes.js --dir ./release/v0.1.1
 *
 * ── CI MODE (GitHub Actions) ─────────────────────────────────────────────────
 * Accepts pre-computed asset metadata and release info as JSON files, then
 * writes the merged result into latest.json. Used by the release workflow
 * after assets have already been downloaded and hashed by the workflow steps.
 *
 * Usage:
 *   node scripts/update-hashes.js <assets-json> <release-json> [--out <manifest>]
 *
 * Arguments:
 *   assets-json   Path to a JSON file: array of
 *                   { platform, filename, url, sha256, size }
 *   release-json  Path to a JSON file:
 *                   { version, releaseDate, prerelease,
 *                     releaseNotes, releaseNotesUrl, mandatory }
 *
 * Options:
 *   --out   Output path for the manifest (default: latest.json)
 *
 * Example:
 *   node scripts/update-hashes.js /tmp/assets.json /tmp/release.json
 */

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Computes the SHA-256 hash of a file by streaming it — memory-safe for
 * large binaries (e.g. 200 MB+ installers).
 *
 * @param {string} filePath  Absolute or relative path to the file
 * @returns {Promise<string>} Hex-encoded SHA-256 digest
 */
function sha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream = fs.createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', reject)
  })
}

/**
 * Returns the byte size of a file.
 *
 * @param {string} filePath
 * @returns {number}
 */
function fileSize(filePath) {
  return fs.statSync(filePath).size
}

/**
 * Parses a flat list of CLI args into a key→value map.
 * Supports --key value and --key=value forms.
 * Positional (non-flag) arguments are collected under the '_' key as an array.
 *
 * @param {string[]} argv  process.argv.slice(2)
 * @returns {Record<string, string | string[]>}
 */
function parseArgs(argv) {
  const result = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg.startsWith('--')) {
      const [key, inlineVal] = arg.slice(2).split('=')
      result[key] = inlineVal !== undefined ? inlineVal : argv[++i] ?? ''
    } else {
      result._.push(arg)
    }
  }
  return result
}

/**
 * Reads and JSON-parses a file, exiting with code 1 on any error.
 *
 * @param {string} filePath
 * @param {string} label  Human-readable label for error messages
 * @returns {unknown}
 */
function readJson(filePath, label) {
  const resolved = path.resolve(filePath)
  if (!fs.existsSync(resolved)) {
    console.error(`Error: ${label} not found: ${resolved}`)
    process.exit(1)
  }
  try {
    return JSON.parse(fs.readFileSync(resolved, 'utf8'))
  } catch (err) {
    console.error(`Error: failed to parse ${label} (${resolved}): ${err.message}`)
    process.exit(1)
  }
}

// ---------------------------------------------------------------------------
// CI mode
// ---------------------------------------------------------------------------

/**
 * CI mode: merges pre-computed asset metadata + release info into latest.json.
 *
 * @param {string[]} positional  [assetsJsonPath, releaseJsonPath]
 * @param {Record<string, string>} args  Parsed flags
 */
function runCiMode(positional, args) {
  const [assetsJsonPath, releaseJsonPath] = positional

  if (!assetsJsonPath || !releaseJsonPath) {
    console.error('Error: CI mode requires two positional arguments: <assets-json> <release-json>')
    console.error('Usage: node scripts/update-hashes.js <assets-json> <release-json> [--out <manifest>]')
    process.exit(1)
  }

  // Read and validate inputs
  const assets = readJson(assetsJsonPath, 'assets JSON')
  const release = readJson(releaseJsonPath, 'release JSON')

  if (!Array.isArray(assets) || assets.length === 0) {
    console.error('Error: assets JSON must be a non-empty array of asset objects')
    process.exit(1)
  }

  const requiredReleaseFields = ['version', 'releaseDate']
  for (const field of requiredReleaseFields) {
    if (!release[field]) {
      console.error(`Error: release JSON is missing required field: "${field}"`)
      process.exit(1)
    }
  }

  // Validate each asset entry
  const requiredAssetFields = ['platform', 'filename', 'url', 'sha256', 'size']
  for (const [i, asset] of assets.entries()) {
    for (const field of requiredAssetFields) {
      if (asset[field] === undefined || asset[field] === null) {
        console.error(`Error: asset[${i}] is missing required field: "${field}"`)
        process.exit(1)
      }
    }
  }

  // Build the platforms map from the assets array
  const platforms = {}
  for (const asset of assets) {
    platforms[asset.platform] = {
      url: asset.url,
      sha256: asset.sha256,
      size: asset.size,
      filename: asset.filename,
    }
  }

  // Compose the full manifest
  const manifest = {
    version: release.version,
    releaseDate: release.releaseDate,
    releaseNotes: release.releaseNotes ?? '',
    releaseNotesUrl: release.releaseNotesUrl ?? '',
    mandatory: release.mandatory ?? false,
    prerelease: release.prerelease ?? false,
    platforms,
  }

  // Write output
  const outPath = path.resolve(args.out ?? 'latest.json')
  try {
    fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8')
  } catch (err) {
    console.error(`Error: failed to write ${outPath}: ${err.message}`)
    process.exit(1)
  }

  console.log(`latest.json updated → ${outPath}`)
  console.log(`  version:   ${manifest.version}`)
  console.log(`  date:      ${manifest.releaseDate}`)
  console.log(`  prerelease: ${manifest.prerelease}`)
  console.log(`  platforms: ${Object.keys(platforms).join(', ')}`)
}

// ---------------------------------------------------------------------------
// Local mode
// ---------------------------------------------------------------------------

/**
 * Local mode: hashes binaries in a directory and updates latest.json in place.
 *
 * @param {Record<string, string>} args  Parsed flags (must include .dir)
 */
async function runLocalMode(args) {
  const binDir = path.resolve(args.dir)

  if (!fs.existsSync(binDir)) {
    console.error(`Error: directory not found: ${binDir}`)
    process.exit(1)
  }

  const manifestPath = path.resolve(args.json ?? 'latest.json')

  if (!fs.existsSync(manifestPath)) {
    console.error(`Error: manifest not found: ${manifestPath}`)
    process.exit(1)
  }

  let manifest
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  } catch (err) {
    console.error(`Error: failed to parse ${manifestPath}: ${err.message}`)
    process.exit(1)
  }

  const platforms = manifest.platforms ?? {}
  const platformKeys = Object.keys(platforms)

  if (platformKeys.length === 0) {
    console.error('Error: no platforms found in manifest')
    process.exit(1)
  }

  console.log(`Manifest:  ${manifestPath}`)
  console.log(`Binaries:  ${binDir}`)
  console.log(`Platforms: ${platformKeys.join(', ')}`)
  console.log()

  let updatedCount = 0
  let skippedCount = 0

  for (const [platform, entry] of Object.entries(platforms)) {
    const filename = entry.filename
    if (!filename) {
      console.warn(`  [SKIP] ${platform}: no "filename" field in manifest`)
      skippedCount++
      continue
    }

    const filePath = path.join(binDir, filename)

    if (!fs.existsSync(filePath)) {
      console.warn(`  [SKIP] ${platform}: file not found → ${filePath}`)
      skippedCount++
      continue
    }

    process.stdout.write(`  [....] ${platform}: hashing ${filename} ...`)

    try {
      const [hash, size] = await Promise.all([
        sha256(filePath),
        Promise.resolve(fileSize(filePath)),
      ])

      entry.sha256 = hash
      entry.size = size

      process.stdout.write(`\r  [OK]   ${platform}: ${hash}  (${(size / 1024 / 1024).toFixed(2)} MB)\n`)
      updatedCount++
    } catch (err) {
      process.stdout.write(`\r  [FAIL] ${platform}: ${err.message}\n`)
      skippedCount++
    }
  }

  console.log()

  if (updatedCount === 0) {
    console.error('No platforms were updated. Check that your --dir contains the expected filenames:')
    for (const [platform, entry] of Object.entries(platforms)) {
      console.error(`  ${platform}: ${entry.filename}`)
    }
    process.exit(1)
  }

  try {
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8')
    console.log(`Updated ${updatedCount} platform(s) in ${manifestPath}`)
    if (skippedCount > 0) {
      console.log(`Skipped  ${skippedCount} platform(s) (files not found or errors above)`)
    }
  } catch (err) {
    console.error(`Error: failed to write ${manifestPath}: ${err.message}`)
    process.exit(1)
  }
}

// ---------------------------------------------------------------------------
// Entry point — dispatch based on mode
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (args.dir) {
    // Local mode: --dir was provided
    await runLocalMode(args)
  } else if (args._.length >= 2) {
    // CI mode: two positional JSON file paths provided
    runCiMode(args._, args)
  } else {
    console.error('Error: no mode detected. Provide --dir for local mode or two JSON file paths for CI mode.')
    console.error()
    console.error('Local mode:  node scripts/update-hashes.js --dir <path-to-release-binaries>')
    console.error('CI mode:     node scripts/update-hashes.js <assets-json> <release-json>')
    process.exit(1)
  }
}

main()
