// Code under test that uses built-in modules through named, namespace and default imports.
import { exec } from 'node:child_process'
import * as fsp from 'node:fs/promises'
import os from 'node:os'

export const notify = message => new Promise((resolve, reject) => exec(`notify-send "${message}"`, async error => {
  if (error) return reject(error)
  await fsp.writeFile('/tmp/last-notify.txt', message)
  resolve(os.hostname())
}))
