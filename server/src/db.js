import dotenv from 'dotenv'
import pg from 'pg'
import { readFileSync, readdirSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve as resolvePath } from 'path'

dotenv.config()

const { Pool } = pg

export const pool = new Pool({ connectionString: process.env.DATABASE_URL })

export async function initDb() {
  // Executa todos os arquivos .sql em ordem
  const __dirname = dirname(fileURLToPath(import.meta.url))
  const sqlDir = resolvePath(__dirname, '../sql')
  const files = readdirSync(sqlDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
  for (const f of files) {
    const script = readFileSync(resolvePath(sqlDir, f), 'utf8')
    if (script.trim().length === 0) continue
    await pool.query(script)
  }
}

export async function withClient(fn) {
  const client = await pool.connect()
  try {
    return await fn(client)
  } finally {
    client.release()
  }
}
