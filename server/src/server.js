import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { randomUUID } from 'crypto'
import { z } from 'zod'
import { pool, withClient, initDb } from './db.js'
import { configureWebPush, saveSubscription, deleteSubscription, notifyTicket } from './push.js'

dotenv.config()
configureWebPush()

const app = express()
app.use(express.json())

// CORS config: suporta lista separada por vírgula ou '*'
function getCorsOrigin() {
  const raw = process.env.ALLOWED_ORIGIN
  if (!raw || raw === '*' || raw.trim() === '') return true
  const items = raw.split(',').map(s => s.trim()).filter(Boolean)
  return items.length === 1 ? items[0] : items
}
app.use(cors({ origin: getCorsOrigin() }))

// Service day boundary (default 5 AM local time)
function getServiceDate() {
  const h = Number(process.env.SHIFT_START_HOUR || 5)
  const now = new Date()
  const shifted = new Date(now.getTime() - h * 60 * 60 * 1000)
  // Return YYYY-MM-DD
  return shifted.toISOString().slice(0, 10)
}

function getServiceBounds() {
  const h = Number(process.env.SHIFT_START_HOUR || 5)
  const now = new Date()
  const shifted = new Date(now.getTime() - h * 60 * 60 * 1000)
  const midnightShifted = new Date(shifted.getFullYear(), shifted.getMonth(), shifted.getDate())
  const start = new Date(midnightShifted.getTime() + h * 60 * 60 * 1000)
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
  return { start: start.toISOString(), end: end.toISOString(), serviceDate: start.toISOString().slice(0, 10) }
}

// ----- SSE infrastructure -----
const shopCurrentStreams = new Map() // shopCode -> Set(res)
const shopListStreams = new Map()    // shopCode -> Set(res)
const shopSettingsStreams = new Map() // shopCode -> Set(res)
const shopTicketStreams = new Map()   // shopCode -> Set({res, ticketId})
const shopPublicListStreams = new Map() // shopCode -> Set(res)

// Notifier cache (in-memory) to avoid duplicate pushes
const notified = {
  called: new Set(),
  pos: new Map(), // ticketId -> lastNotifiedPos
}

function getGraceMinutes() {
  const v = Number(process.env.GRACE_MINUTES || 10)
  return Number.isFinite(v) && v > 0 ? v : 10
}

function getGraceTriggerPosition() {
  const v = Number(process.env.GRACE_TRIGGER_POSITION || 2)
  return Number.isFinite(v) && v > 0 ? v : 2
}

async function cleanupExpired(shopCode) {
  try {
    const shift = Number(process.env.SHIFT_START_HOUR || 5)
    const r = await pool.query(
      `UPDATE queue_entries q
          SET status = 'canceled'
        WHERE q.shop_code = $1
          AND q.status = 'waiting'
          AND q.grace_expires_at IS NOT NULL
          AND q.arrived_at IS NULL
          AND q.grace_expires_at < NOW()
        RETURNING q.id`,
      [shopCode]
    )
    if (r.rowCount > 0) {
      await broadcastList(shopCode)
    }
  } catch (e) {
    console.error('cleanupExpired error:', e)
  }
}

async function ensureGraceForSecond(shopCode) {
  try {
    const triggerPos = getGraceTriggerPosition()
    const offset = Math.max(0, triggerPos - 1)
    const q = await pool.query(
      `SELECT id, grace_expires_at, arrived_at
         FROM queue_entries
        WHERE shop_code = $1 AND status = 'waiting'
        ORDER BY created_at ASC
        OFFSET $2 LIMIT 1`,
      [shopCode, offset]
    )
    if (q.rows.length === 0) return
    const row = q.rows[0]
    if (!row.grace_expires_at && !row.arrived_at) {
      const minutes = getGraceMinutes()
      await pool.query(
        `UPDATE queue_entries SET grace_expires_at = NOW() + ($2 || ' minutes')::interval WHERE id = $1`,
        [row.id, String(minutes)]
      )
    }
  } catch (e) {
    console.error('ensureGraceForSecond error:', e)
  }
}

function sseAdd(streamsMap, key, res) {
  if (!streamsMap.has(key)) streamsMap.set(key, new Set())
  streamsMap.get(key).add(res)
}
function sseRemove(streamsMap, key, res) {
  const set = streamsMap.get(key)
  if (!set) return
  set.delete(res)
  if (set.size === 0) streamsMap.delete(key)
}
function sseSend(res, event, data) {
  res.write(`event: ${event}\n`)
  res.write(`data: ${JSON.stringify(data)}\n\n`)
}

async function computeCurrentNumber(shopCode) {
  const shift = Number(process.env.SHIFT_START_HOUR || 5)
  const cur = await pool.query(
    `WITH b AS (
       SELECT date_trunc('day', now() - ($2 || ' hours')::interval) + ($2 || ' hours')::interval AS start_ts
     )
     SELECT COALESCE(MAX(q.ticket_number), 0) AS current
       FROM queue_entries q, b
      WHERE q.shop_code = $1
        AND q.status IN ('called','served')
        AND (
          (q.called_at  >= b.start_ts AND q.called_at  < b.start_ts + interval '1 day')
          OR (q.served_at  >= b.start_ts AND q.served_at  < b.start_ts + interval '1 day')
        )`,
    [shopCode, String(shift)]
  )
  return Number(cur.rows[0]?.current || 0)
}

async function broadcastCurrent(shopCode) {
  const set = shopCurrentStreams.get(shopCode)
  if (!set || set.size === 0) return
  const currentNumber = await computeCurrentNumber(shopCode)
  for (const res of set) sseSend(res, 'current', { currentNumber })
}

async function broadcastList(shopCode) {
  const set = shopListStreams.get(shopCode)
  if (!set || set.size === 0) return
  const { rows } = await pool.query(
    `SELECT id, customer_name, service_type, created_at, ticket_number
       FROM queue_entries WHERE shop_code = $1 AND status = 'waiting'
       ORDER BY created_at ASC`,
    [shopCode]
  )
  for (const res of set) sseSend(res, 'list', rows)
}

async function broadcastPublicList(shopCode) {
  const set = shopPublicListStreams.get(shopCode)
  if (!set || set.size === 0) return
  const { rows } = await pool.query(
    `SELECT ticket_number, created_at
       FROM queue_entries WHERE shop_code = $1 AND status = 'waiting'
       ORDER BY created_at ASC
       LIMIT 12`,
    [shopCode]
  )
  const out = rows.map(r => ({ ticket_number: r.ticket_number, created_at: r.created_at }))
  for (const res of set) sseSend(res, 'public_list', out)
}

async function computeTicketInfo(ticketId) {
  const r = await pool.query('SELECT * FROM queue_entries WHERE id = $1', [ticketId])
  const entry = r.rows[0]
  if (!entry) return null
  const waiting = await pool.query(
    `SELECT id, created_at FROM queue_entries
       WHERE shop_code = $1 AND status = 'waiting'
       ORDER BY created_at ASC`,
    [entry.shop_code]
  )
  const index = waiting.rows.findIndex(w => w.id === ticketId)
  const position = index === -1 ? null : index + 1
  const ahead = index === -1 ? 0 : index
  const estimate = index === -1 ? 0 : ahead * 15
  // current number for service day
  const currentNumber = await computeCurrentNumber(entry.shop_code)
  // ensure/set grace when reaching trigger position
  const triggerPos = getGraceTriggerPosition()
  let graceExpiresAt = entry.grace_expires_at
  if (position === triggerPos && !entry.arrived_at && !entry.grace_expires_at) {
    const minutes = getGraceMinutes()
    const up = await pool.query(
      `UPDATE queue_entries SET grace_expires_at = NOW() + ($2 || ' minutes')::interval WHERE id = $1 RETURNING grace_expires_at`,
      [ticketId, String(minutes)]
    )
    graceExpiresAt = up.rows[0]?.grace_expires_at || null
  }
  let graceSecondsLeft = null
  if (graceExpiresAt) {
    const exp = new Date(graceExpiresAt)
    graceSecondsLeft = Math.max(0, Math.floor((exp.getTime() - Date.now()) / 1000))
  }
  return {
    ticketId,
    shopCode: entry.shop_code,
    status: entry.status,
    position,
    ahead,
    estimateMinutes: estimate,
    ticketNumber: entry.ticket_number,
    ticketDate: entry.ticket_date,
    currentNumber,
    graceExpiresAt,
    graceSecondsLeft,
  }
}

async function broadcastTicketPositions(shopCode) {
  const set = shopTicketStreams.get(shopCode)
  if (!set || set.size === 0) return
  for (const sub of set) {
    try {
      const info = await computeTicketInfo(sub.ticketId)
      if (info) {
        sseSend(sub.res, 'ticket', info)
        const trig = getGraceTriggerPosition()
        // Push: notify when reaching trigger position (e.g., 2)
        if (info.position === trig && info.status !== 'called') {
          const last = notified.pos.get(info.ticketId)
          if (last !== trig) {
            try {
              await notifyTicket(info.ticketId, {
                title: 'Sua vez está chegando',
                body: `Prepare-se. Senha ${info.ticketNumber}`,
                tag: 'position'
              })
            } catch {}
            notified.pos.set(info.ticketId, trig)
          }
        }
      }
    } catch {}
  }
}

async function getShopSettings(shopCode) {
  const r = await pool.query(
    `SELECT paused, pause_message FROM shop_settings WHERE shop_code = $1`,
    [shopCode]
  )
  if (r.rows.length === 0) return { paused: false, pause_message: null }
  return r.rows[0]
}

async function broadcastSettings(shopCode) {
  const set = shopSettingsStreams.get(shopCode)
  if (!set || set.size === 0) return
  const s = await getShopSettings(shopCode)
  for (const res of set) sseSend(res, 'settings', s)
}

// Simple admin auth via Bearer token
function checkAdmin(req, res, next) {
  const header = req.headers['authorization'] || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!process.env.ADMIN_TOKEN) {
    return res.status(500).json({ error: 'ADMIN_TOKEN não configurado' })
  }
  if (!token || token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Não autorizado' })
  }
  next()
}

// Healthcheck
app.get('/api/health', (req, res) => {
  res.json({ ok: true })
})

app.get('/api/health/db', async (req, res) => {
  try {
    const ping = await pool.query('SELECT 1 as ok')
    const table = await pool.query("SELECT to_regclass('public.queue_entries') as t")
    const counters = await pool.query("SELECT to_regclass('public.queue_counters') as t")
    const cols = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'queue_entries'
    `)
    const hasTicketNumber = cols.rows.some(r => r.column_name === 'ticket_number')
    res.json({
      ok: true,
      db: ping.rows[0].ok === 1,
      hasQueueTable: !!table.rows[0].t,
      hasCountersTable: !!counters.rows[0].t,
      hasTicketNumber,
    })
  } catch (e) {
    console.error('DB health error:', e)
    res.status(500).json({ ok: false, error: e.message })
  }
})

// Join queue
app.post('/api/queue/join', async (req, res) => {
  const schema = z.object({
    shopCode: z.string().min(1),
    name: z.string().min(1),
    phone: z.string().optional(),
    serviceType: z.string().optional(),
  })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: 'Dados inválidos', details: parsed.error.flatten() })
  }
  const { shopCode, name, phone, serviceType } = parsed.data
  const id = randomUUID()
  try {
    // Check pause
    const settings = await getShopSettings(shopCode)
    if (settings.paused) {
      return res.status(423).json({ error: settings.pause_message || 'Fila temporariamente pausada' })
    }
    const result = await withClient(async (client) => {
      await client.query('BEGIN')
      try {
        const shift = Number(process.env.SHIFT_START_HOUR || 5)
        const serviceDate = getServiceDate()
        // Garante linha do contador do dia
        await client.query(
          `INSERT INTO queue_counters (shop_code, counter_date, last_number)
           VALUES ($1, $2::date, 0)
           ON CONFLICT (shop_code, counter_date) DO NOTHING`,
          [shopCode, serviceDate]
        )
        // Trava o contador para cálculo atômico
        const lock = await client.query(
          `SELECT last_number FROM queue_counters WHERE shop_code = $1 AND counter_date = $2::date FOR UPDATE`,
          [shopCode, serviceDate]
        )
        const lastCounter = lock.rows[0]?.last_number ?? 0
        // Max já utilizado hoje (qualquer status relevante) com base em janela do dia de serviço
        const maxDbRes = await client.query(
          `WITH b AS (
             SELECT date_trunc('day', now() - ($2 || ' hours')::interval) + ($2 || ' hours')::interval AS start_ts
           )
           SELECT COALESCE(MAX(q.ticket_number), 0) AS maxnum
             FROM queue_entries q, b
            WHERE q.shop_code = $1
              AND (
                (q.created_at >= b.start_ts AND q.created_at < b.start_ts + interval '1 day')
                OR (q.called_at  >= b.start_ts AND q.called_at  < b.start_ts + interval '1 day')
                OR (q.served_at  >= b.start_ts AND q.served_at  < b.start_ts + interval '1 day')
                OR (q.ticket_date = (b.start_ts::date))
              )`,
          [shopCode, String(shift)]
        )
        const maxUsed = maxDbRes.rows[0]?.maxnum ?? 0
        const nextNumber = Math.min(1000, Math.max(lastCounter, maxUsed) + 1)
        if (nextNumber > 1000) {
          await client.query('ROLLBACK')
          return { full: true }
        }
        // Atualiza o contador para o novo valor calculado
        await client.query(
          `UPDATE queue_counters SET last_number = $3 WHERE shop_code = $1 AND counter_date = $2::date`,
          [shopCode, serviceDate, nextNumber]
        )
        await client.query(
          `INSERT INTO queue_entries (id, shop_code, customer_name, phone, service_type, status, ticket_number, ticket_date)
           VALUES ($1, $2, $3, $4, $5, 'waiting', $6, $7::date)`,
          [id, shopCode, name, phone || null, serviceType || null, nextNumber, serviceDate]
        )
        await client.query('COMMIT')
        return { ticketNumber: nextNumber }
      } catch (err) {
        try { await client.query('ROLLBACK') } catch {}
        throw err
      }
    })
    if (result.full) return res.status(409).json({ error: 'Limite diário atingido (1000 senhas)' })
    res.status(201).json({ ticketId: id, ticketNumber: result.ticketNumber })
    // realtime: atualizar lista do painel e preparar graça para posição gatilho
    broadcastList(shopCode).catch(() => {})
    ensureGraceForSecond(shopCode).catch(() => {})
    broadcastTicketPositions(shopCode).catch(() => {})
    try {
      await notifyTicket(rows[0].id, {
        title: 'Você foi chamado!',
        body: `Apresente-se no atendimento. Senha ${rows[0].ticket_number}`,
        tag: 'called'
      })
    } catch {}
  } catch (e) {
    console.error('Join error:', { message: e.message, code: e.code, detail: e.detail })
    if (e.code === '42P01' || String(e.message || '').includes('queue_counters')) {
      try {
        await initDb()
        // tentar novamente uma vez
        const retry = await withClient(async (client) => {
          await client.query('BEGIN')
          try {
            const serviceDate = getServiceDate()
            await client.query(
              `INSERT INTO queue_counters (shop_code, counter_date, last_number)
               VALUES ($1, $2::date, 0)
               ON CONFLICT (shop_code, counter_date) DO NOTHING`,
              [shopCode, serviceDate]
            )
            const upd = await client.query(
              `UPDATE queue_counters
                 SET last_number = last_number + 1
               WHERE shop_code = $1 AND counter_date = $2::date
               RETURNING last_number`,
              [shopCode, serviceDate]
            )
            const nextNumber = upd.rows[0]?.last_number || 1
            if (nextNumber > 1000) {
              await client.query('ROLLBACK')
              return { full: true }
            }
            await client.query(
              `INSERT INTO queue_entries (id, shop_code, customer_name, phone, service_type, status, ticket_number, ticket_date)
               VALUES ($1, $2, $3, $4, $5, 'waiting', $6, $7::date)`,
              [id, shopCode, name, phone || null, serviceType || null, nextNumber, serviceDate]
            )
            await client.query('COMMIT')
            return { ticketNumber: nextNumber }
          } catch (err) {
            try { await client.query('ROLLBACK') } catch {}
            throw err
          }
        })
        if (retry.full) return res.status(409).json({ error: 'Limite diário atingido (1000 senhas)' })
        res.status(201).json({ ticketId: id, ticketNumber: retry.ticketNumber })
        broadcastList(shopCode).catch(() => {})
        return
      } catch (e2) {
        console.error('Join retry after initDb failed:', { message: e2.message, code: e2.code, detail: e2.detail })
      }
    }
    res.status(500).json({ error: 'Erro ao entrar na fila' })
  }
})

// Get position by ticket
app.get('/api/queue/position/:ticketId', async (req, res) => {
  const { ticketId } = req.params
  try {
    const { rows } = await pool.query('SELECT * FROM queue_entries WHERE id = $1', [ticketId])
    const entry = rows[0]
    if (!entry) return res.status(404).json({ error: 'Ticket não encontrado' })

    const waiting = await pool.query(
      `SELECT id, created_at FROM queue_entries
       WHERE shop_code = $1 AND status = 'waiting'
       ORDER BY created_at ASC`,
      [entry.shop_code]
    )
    const index = waiting.rows.findIndex(r => r.id === ticketId)
    const position = index === -1 ? null : index + 1

    // Estimativa simples: 15 min por cliente à frente
    const avgMinutes = 15
    const ahead = index === -1 ? 0 : index
    const estimate = index === -1 ? 0 : ahead * avgMinutes

    // Número atual sendo atendido no mesmo dia de serviço
    let currentNumber = 0
    if (entry.ticket_date) {
      const cur = await pool.query(
        `SELECT COALESCE(MAX(ticket_number), 0) AS current
           FROM queue_entries
          WHERE shop_code = $1 AND ticket_date = $2::date AND status IN ('called','served')`,
        [entry.shop_code, entry.ticket_date]
      )
      currentNumber = Number(cur.rows[0]?.current || 0)
    }

    // Ajuste robusto: considera janela do dia de serviço
    try {
      const currentFromBounds = await computeCurrentNumber(entry.shop_code)
      if (currentFromBounds > currentNumber) currentNumber = currentFromBounds
    } catch {}

    res.json({
      status: entry.status,
      position,
      ahead,
      estimateMinutes: estimate,
      shopCode: entry.shop_code,
      ticketNumber: entry.ticket_number,
      ticketDate: entry.ticket_date,
      currentNumber,
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Erro ao consultar posição' })
  }
})

// List waiting queue (admin/painel)
app.get('/api/queue/list', checkAdmin, async (req, res) => {
  const shopCode = req.query.shopCode
  if (!shopCode) return res.status(400).json({ error: 'shopCode é obrigatório' })
  try {
    const { rows } = await pool.query(
      `SELECT id, customer_name, service_type, created_at, ticket_number, arrived_at
       FROM queue_entries WHERE shop_code = $1 AND status = 'waiting'
       ORDER BY created_at ASC`,
      [shopCode]
    )
    res.json(rows)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Erro ao listar fila' })
  }
})

// SSE: current number for a shop (public)
app.get('/api/queue/stream/current', async (req, res) => {
  const shopCode = req.query.shopCode
  if (!shopCode) return res.status(400).json({ error: 'shopCode é obrigatório' })
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders?.()
  sseAdd(shopCurrentStreams, shopCode, res)
  // send initial
  computeCurrentNumber(shopCode).then((n) => sseSend(res, 'current', { currentNumber: n })).catch(() => {})
  req.on('close', () => sseRemove(shopCurrentStreams, shopCode, res))
})

// SSE: waiting list for a shop (admin via token query)
app.get('/api/queue/stream/list', async (req, res) => {
  const shopCode = req.query.shopCode
  const token = req.query.token
  if (!shopCode) return res.status(400).json({ error: 'shopCode é obrigatório' })
  if (!token || token !== process.env.ADMIN_TOKEN) return res.status(401).json({ error: 'Não autorizado' })
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders?.()
  sseAdd(shopListStreams, shopCode, res)
  // initial snapshot
  pool.query(
    `SELECT id, customer_name, service_type, created_at, ticket_number
       FROM queue_entries WHERE shop_code = $1 AND status = 'waiting'
       ORDER BY created_at ASC`,
    [shopCode]
  ).then(({ rows }) => sseSend(res, 'list', rows)).catch(() => {})
  req.on('close', () => sseRemove(shopListStreams, shopCode, res))
})

// Push: expose public VAPID key
app.get('/api/push/public-key', (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || '' })
})

// Push subscription endpoints
app.post('/api/push/subscribe', async (req, res) => {
  try {
    const schema = z.object({
      shopCode: z.string().min(1),
      ticketId: z.string().uuid(),
      subscription: z.any()
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'Dados inválidos' })
    await saveSubscription(parsed.data)
    res.json({ ok: true })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Erro ao salvar inscrição de push' })
  }
})

app.post('/api/push/unsubscribe', async (req, res) => {
  try {
    const schema = z.object({ ticketId: z.string().uuid(), endpoint: z.string().url() })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'Dados inválidos' })
    await deleteSubscription(parsed.data)
    res.json({ ok: true })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Erro ao remover inscrição de push' })
  }
})


// SSE: ticket-specific updates for a customer
app.get('/api/queue/stream/ticket/:ticketId', async (req, res) => {
  const { ticketId } = req.params
  try {
    const r = await pool.query('SELECT shop_code FROM queue_entries WHERE id = $1', [ticketId])
    if (r.rows.length === 0) return res.status(404).json({ error: 'Ticket não encontrado' })
    const shopCode = r.rows[0].shop_code
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders?.()
    if (!shopTicketStreams.has(shopCode)) shopTicketStreams.set(shopCode, new Set())
    const sub = { res, ticketId }
    shopTicketStreams.get(shopCode).add(sub)
    // initial snapshot
    const info = await computeTicketInfo(ticketId)
    if (info) sseSend(res, 'ticket', info)
    req.on('close', () => {
      const set = shopTicketStreams.get(shopCode)
      if (set) {
        set.delete(sub)
        if (set.size === 0) shopTicketStreams.delete(shopCode)
      }
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Erro ao abrir stream do ticket' })
  }
})

// SSE: shop settings (pause/message) public
app.get('/api/queue/stream/settings', async (req, res) => {
  const shopCode = req.query.shopCode
  if (!shopCode) return res.status(400).json({ error: 'shopCode é obrigatório' })
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders?.()
  sseAdd(shopSettingsStreams, shopCode, res)
  getShopSettings(shopCode).then((s) => sseSend(res, 'settings', s)).catch(() => {})
  req.on('close', () => sseRemove(shopSettingsStreams, shopCode, res))
})

// Services (public list)
app.get('/api/services', async (req, res) => {
  const shopCode = req.query.shopCode
  if (!shopCode) return res.status(400).json({ error: 'shopCode é obrigatório' })
  try {
    const { rows } = await pool.query(
      `SELECT id, name, duration_minutes FROM services WHERE shop_code = $1 AND active = TRUE ORDER BY name ASC`,
      [shopCode]
    )
    res.json(rows)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Erro ao listar serviços' })
  }
})

// Services (admin create)
app.post('/api/services', checkAdmin, async (req, res) => {
  const schema = z.object({ shopCode: z.string().min(1), name: z.string().min(1), durationMinutes: z.number().int().positive().optional() })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Dados inválidos' })
  const { shopCode, name, durationMinutes } = parsed.data
  const id = randomUUID()
  try {
    await pool.query(
      `INSERT INTO services (id, shop_code, name, duration_minutes, active) VALUES ($1, $2, $3, $4, TRUE)`,
      [id, shopCode, name, durationMinutes ?? null]
    )
    res.status(201).json({ id })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Erro ao criar serviço' })
  }
})

// Services (admin delete/deactivate)
app.delete('/api/services/:id', checkAdmin, async (req, res) => {
  const { id } = req.params
  try {
    await pool.query(`UPDATE services SET active = FALSE WHERE id = $1`, [id])
    res.json({ ok: true })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Erro ao remover serviço' })
  }
})

// Shop settings endpoints
app.get('/api/shop/settings', async (req, res) => {
  const shopCode = req.query.shopCode
  if (!shopCode) return res.status(400).json({ error: 'shopCode é obrigatório' })
  try {
    const s = await getShopSettings(shopCode)
    res.json(s)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Erro ao buscar configurações' })
  }
})

app.post('/api/shop/settings', checkAdmin, async (req, res) => {
  const schema = z.object({ shopCode: z.string().min(1), paused: z.boolean(), pauseMessage: z.string().nullable().optional() })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Dados inválidos' })
  const { shopCode, paused, pauseMessage } = parsed.data
  try {
    await pool.query(
      `INSERT INTO shop_settings (shop_code, paused, pause_message, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (shop_code)
       DO UPDATE SET paused = EXCLUDED.paused, pause_message = EXCLUDED.pause_message, updated_at = NOW()`,
      [shopCode, paused, pauseMessage ?? null]
    )
    res.json({ ok: true })
    broadcastSettings(shopCode).catch(() => {})
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Erro ao salvar configurações' })
  }
})

// Current called/served ticket number for today (admin)
app.get('/api/queue/current', checkAdmin, async (req, res) => {
  const shopCode = req.query.shopCode
  if (!shopCode) return res.status(400).json({ error: 'shopCode é obrigatório' })
  try {
    const serviceDate = getServiceDate()
    const cur = await pool.query(
      `SELECT COALESCE(MAX(ticket_number), 0) AS current
         FROM queue_entries
        WHERE shop_code = $1 AND ticket_date = $2::date AND status IN ('called','served')`,
      [shopCode, serviceDate]
    )
    res.json({ currentNumber: Number(cur.rows[0]?.current || 0), serviceDate })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Erro ao consultar senha atual' })
  }
})

// Call next in queue (admin)
app.post('/api/queue/next', checkAdmin, async (req, res) => {
  const schema = z.object({ shopCode: z.string().min(1) })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Dados inválidos' })
  const { shopCode } = parsed.data
  try {
    const rows = await withClient(async (client) => {
      await client.query('BEGIN')
      try {
        const next = await client.query(
          `SELECT id FROM queue_entries WHERE shop_code = $1 AND status = 'waiting'
           ORDER BY created_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED`,
          [shopCode]
        )
        if (next.rows.length === 0) {
          await client.query('COMMIT')
          return []
        }
        const ticketId = next.rows[0].id
        await client.query(
          `UPDATE queue_entries SET status = 'called', called_at = NOW() WHERE id = $1`,
          [ticketId]
        )
        await client.query('COMMIT')
        const tn = await client.query('SELECT ticket_number FROM queue_entries WHERE id = $1', [ticketId])
        return [{ id: ticketId, ticket_number: tn.rows[0]?.ticket_number }]
      } catch (err) {
        try { await client.query('ROLLBACK') } catch {}
        throw err
      }
    })
    if (rows.length === 0) return res.json({ message: 'Fila vazia' })
    res.json({ ticketId: rows[0].id, ticketNumber: rows[0].ticket_number })
    // realtime: atualizar n�mero atual e lista
    broadcastCurrent(shopCode).catch(() => {})
    broadcastList(shopCode).catch(() => {})
    ensureGraceForSecond(shopCode).catch(() => {})
    broadcastTicketPositions(shopCode).catch(() => {})
    try {
      await notifyTicket(rows[0].id, {
        title: 'Você foi chamado!',
        body: `Apresente-se no atendimento. Senha ${rows[0].ticket_number}`,
        tag: 'called'
      })
    } catch {}
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Erro ao chamar próximo' })
  }
})

// Complete or cancel ticket
app.post('/api/queue/:ticketId/complete', checkAdmin, async (req, res) => {
  const { ticketId } = req.params
  try {
    const r = await pool.query('UPDATE queue_entries SET status = \'served\', served_at = NOW() WHERE id = $1 RETURNING shop_code', [ticketId])
    res.json({ ok: true })
    const shopCode = r.rows[0]?.shop_code
    if (shopCode) { broadcastList(shopCode).catch(() => {}); ensureGraceForSecond(shopCode).catch(() => {}); broadcastTicketPositions(shopCode).catch(() => {}) }
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Erro ao concluir atendimento' })
  }
})

app.post('/api/queue/:ticketId/cancel', checkAdmin, async (req, res) => {
  const { ticketId } = req.params
  try {
    const r = await pool.query("UPDATE queue_entries SET status = 'canceled' WHERE id = $1 RETURNING shop_code", [ticketId])
    res.json({ ok: true })
    const shopCode = r.rows[0]?.shop_code
    if (shopCode) { broadcastList(shopCode).catch(() => {}); ensureGraceForSecond(shopCode).catch(() => {}); broadcastTicketPositions(shopCode).catch(() => {}) }
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Erro ao cancelar' })
  }
})

// Customer arrival confirmation
app.post('/api/queue/:ticketId/arrive', async (req, res) => {
  const { ticketId } = req.params
  try {
    const r = await pool.query(
      `UPDATE queue_entries SET arrived_at = NOW() WHERE id = $1 RETURNING shop_code`,
      [ticketId]
    )
    if (r.rowCount === 0) return res.status(404).json({ error: 'Ticket não encontrado' })
    res.json({ ok: true })
    const shopCode = r.rows[0]?.shop_code
    if (shopCode) broadcastTicketPositions(shopCode).catch(() => {})
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Erro ao confirmar chegada' })
  }
})

// Allow customer to cancel own ticket (leave the queue)
app.post('/api/queue/:ticketId/leave', async (req, res) => {
  const { ticketId } = req.params
  try {
    const r = await pool.query(
      "UPDATE queue_entries SET status = 'canceled' WHERE id = $1 AND status = 'waiting' RETURNING shop_code, status",
      [ticketId]
    )
    if (r.rowCount === 0) return res.status(409).json({ error: 'Não é possível cancelar este ticket' })
    const shopCode = r.rows[0]?.shop_code
    if (shopCode) broadcastList(shopCode).catch(() => {})
    res.json({ ok: true })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Erro ao desistir da fila' })
  }
})

const port = Number(process.env.PORT || 4000)
async function start() {
  try {
    await initDb()
    console.log('DB schema verificado')
  } catch (e) {
    console.error('Falha ao inicializar DB:', e)
  }
  app.listen(port, () => {
    console.log(`Barbearia API rodando em http://localhost:${port}`)
  })
}

start()



