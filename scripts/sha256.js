const crypto = require('node:crypto')
const fs = require('node:fs')

function sha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream = fs.createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', reject)
  })
}

// Read the file path from the first CLI argument
const filePath = process.argv[2]

if (!filePath) {
  console.error('Usage: node scripts/sha256.js <file-path>')
  process.exit(1)
}

sha256(filePath)
  .then((hash) => console.log(hash))
  .catch((err) => {
    console.error(`Error: ${err.message}`)
    process.exit(1)
  })
