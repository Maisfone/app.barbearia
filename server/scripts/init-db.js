import { readFileSync, readdirSync } from 'fs'
import { resolve } from 'path'
import dotenv from 'dotenv'
import pg from 'pg'

dotenv.config()
const { Pool } = pg

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const dir = resolve(process.cwd(), 'server/sql')
  const files = readdirSync(dir).filter(f => f.endsWith('.sql')).sort()
  for (const f of files) {
    const sql = readFileSync(resolve(dir, f), 'utf8')
    if (!sql.trim()) continue
    console.log('Applying migration:', f)
    await pool.query(sql)
  }
  await pool.end()
  console.log('Banco inicializado')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
