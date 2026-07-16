// Load eios-prototype/.env into process.env BEFORE anything reads config.
//
// The repo ships no `dotenv` dependency and the dev/start scripts pass no
// `--env-file`, so `.env` (which SETUP.md tells you to edit) was never actually
// loaded. This module fixes that using Node's built-in env-file loader. It must be
// imported FIRST in index.ts — ES module side effects run in import order, so this
// populates process.env before `config.ts` reads it.

import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { existsSync } from 'node:fs'

// server/src/loadEnv.ts → ../../.env  ==  eios-prototype/.env
const envPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../.env')

if (existsSync(envPath) && typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile(envPath)
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(`[eios] could not load ${envPath}: ${(e as Error).message}`)
  }
}
