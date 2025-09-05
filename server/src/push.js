// Make web-push optional to avoid crashing if not installed
let webpush = null
import { randomUUID } from 'crypto'
import { pool } from './db.js'

export function configureWebPush() {
  // Lazy-load web-push so missing module doesn't crash startup
  import('web-push')
    .then((mod) => {
      webpush = mod.default || mod
      const pub = process.env.VAPID_PUBLIC_KEY
      const priv = process.env.VAPID_PRIVATE_KEY
      const mailto = process.env.VAPID_CONTACT || 'mailto:admin@example.com'
      if (pub && priv) {
        webpush.setVapidDetails(mailto, pub, priv)
      } else {
        console.warn('VAPID keys not set; push disabled')
      }
    })
    .catch(() => {
      console.warn('web-push not installed; push disabled')
      webpush = null
    })
}

export async function saveSubscription({ shopCode, ticketId, subscription }) {
  const id = randomUUID()
  const endpoint = subscription?.endpoint
  if (!endpoint) throw new Error('subscription endpoint missing')
  await pool.query(
    `INSERT INTO push_subscriptions (id, shop_code, ticket_id, endpoint, subscription)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (ticket_id, endpoint) DO UPDATE SET subscription = EXCLUDED.subscription`,
    [id, shopCode, ticketId, endpoint, subscription]
  )
}

export async function deleteSubscription({ ticketId, endpoint }) {
  await pool.query(`DELETE FROM push_subscriptions WHERE ticket_id = $1 AND endpoint = $2`, [ticketId, endpoint])
}

export async function notifyTicket(ticketId, payload) {
  if (!webpush) return
  const { rows } = await pool.query(
    `SELECT subscription FROM push_subscriptions WHERE ticket_id = $1`,
    [ticketId]
  )
  await Promise.all(rows.map(async (r) => {
    try {
      await webpush.sendNotification(r.subscription, JSON.stringify(payload))
    } catch (e) {
      console.warn('Push error:', e?.statusCode || e?.message)
    }
  }))
}
