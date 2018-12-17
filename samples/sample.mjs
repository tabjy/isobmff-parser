import https from 'https'

import { File } from '../'

function request (...args) {
  return new Promise((resolve, reject) => {
    https.get(...args, res => {
      if (res.statusCode !== 200) {
        reject(new Error('non-200 status code: ' + res.statusCode))
      }

      let buffer = Buffer.alloc(0)
      res.on('data', (d) => {
        buffer = Buffer.concat([buffer, d])
      })
      res.on('end', () => resolve(buffer))
      res.on('error', (err) => reject(err))
    })
  })
}

async function main () {
  const buffer = await request('https://storage.googleapis.com/media-session/flac.mp4')

  const file = await File.fromBuffer(buffer)
  console.log(file)

  return 0
}

main().then((code) => process.exit(code)).catch((err) => {
  console.error(`Fatal error: ${err.message}`)
  console.error(err.stack)
  process.exit(1)
})
