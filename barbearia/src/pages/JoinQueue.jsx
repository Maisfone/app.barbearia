import { useEffect, useState } from 'react'
import { api } from '../api.js'

export default function JoinQueue() {
  function getParam(name) {
    const url = new URL(window.location.href)
    const fromSearch = url.searchParams.get(name)
    if (fromSearch) return fromSearch
    // Tenta extrair do hash, ex.: #/join?shop=MINHA_LOJA
    const hash = window.location.hash || ''
    const qIndex = hash.indexOf('?')
    if (qIndex !== -1) {
      const qs = new URLSearchParams(hash.slice(qIndex + 1))
      return qs.get(name)
    }
    return null
  }

  const envDefault = import.meta.env.VITE_DEFAULT_SHOP || null
  const paramShop = getParam('shop')
  const defaultShop = paramShop || envDefault || 'default'
  const lockShop = !!paramShop || !!envDefault
  const [shopCode, setShopCode] = useState(defaultShop)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [serviceType, setServiceType] = useState('')
  const [services, setServices] = useState([])
  const [paused, setPaused] = useState(false)
  const [pauseMsg, setPauseMsg] = useState('')
  const [ticketId, setTicketId] = useState(localStorage.getItem('ticketId') || '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const data = await api('/api/queue/join', {
        method: 'POST',
        body: JSON.stringify({ shopCode, name, phone, serviceType }),
      })
      setTicketId(data.ticketId)
      localStorage.setItem('ticketId', data.ticketId)
      if (data.ticketNumber != null) {
        localStorage.setItem('ticketNumber', String(data.ticketNumber))
      }
      window.location.hash = '#/status'
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // Load services
    if (!shopCode) return
    fetch(`${import.meta.env.VITE_API_BASE || 'http://localhost:4000'}/api/services?shopCode=${encodeURIComponent(shopCode)}`)
      .then(r => r.json())
      .then(rows => { setServices(rows); if (rows[0] && !serviceType) setServiceType(rows[0].name) })
      .catch(() => {})
    // Settings SSE
    const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:4000'
    const es = new EventSource(`${API_BASE}/api/queue/stream/settings?shopCode=${encodeURIComponent(shopCode)}`)
    const onS = (ev) => { try { const s = JSON.parse(ev.data); setPaused(!!s.paused); setPauseMsg(s.pause_message || '') } catch {} }
    es.addEventListener('settings', onS)
    return () => { es.close() }
  }, [shopCode])

  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold">Entrar na fila</h2>
      {paused && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-800">
          {pauseMsg || 'Fila temporariamente pausada'}
        </div>
      )}
      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm space-y-3">
        {!lockShop ? (
          <div>
            <label className="block text-sm font-medium text-gray-700">Barbearia (código)</label>
            <input className="mt-1 w-full rounded-md border-gray-300 shadow-sm focus:border-brand-500 focus:ring-brand-500" value={shopCode} onChange={e => setShopCode(e.target.value)} required />
          </div>
        ) : null}
        <div>
          <label className="block text-sm font-medium text-gray-700">Nome</label>
          <input className="mt-1 w-full rounded-md border-gray-300 shadow-sm focus:border-brand-500 focus:ring-brand-500" value={name} onChange={e => setName(e.target.value)} required />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Telefone (opcional)</label>
          <input className="mt-1 w-full rounded-md border-gray-300 shadow-sm focus:border-brand-500 focus:ring-brand-500" value={phone} onChange={e => setPhone(e.target.value)} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Serviço</label>
          <select className="mt-1 w-full rounded-md border-gray-300 shadow-sm focus:border-brand-500 focus:ring-brand-500" value={serviceType} onChange={e => setServiceType(e.target.value)} disabled={services.length === 0}>
            {services.map(s => (
              <option key={s.id} value={s.name}>{s.name}</option>
            ))}
            {services.length === 0 && <option>Sem serviços cadastrados</option>}
          </select>
        </div>
        <div className="pt-2">
          <button disabled={loading || paused} className="inline-flex items-center rounded-md bg-brand-600 px-4 py-2 text-white hover:bg-brand-700 disabled:opacity-60">
            {loading ? 'Enviando...' : 'Entrar na fila'}
          </button>
        </div>
      </form>
      {error && <p className="text-red-600 text-sm">{error}</p>}
      {ticketId && (
        <div className="text-sm text-gray-700">
          Sua senha: <span className="inline-flex items-center rounded-md bg-brand-600/10 px-2 py-0.5 font-semibold text-brand-700">{localStorage.getItem('ticketNumber')}</span>
        </div>
      )}
      <div className="text-sm text-gray-600">
        QR Code: gere um QR apontando para{' '}
        <code className="bg-gray-100 px-1 py-0.5 rounded">{window.location.origin + window.location.pathname}#/join?shop=SEU_CODIGO</code>
      </div>

    </section>
  )
}
