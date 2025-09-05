import { useEffect, useState } from 'react'
import { api, API_BASE } from '../api.js'

export default function Dashboard() {
  const [shopCode, setShopCode] = useState('dersobarbearia')
  const [list, setList] = useState([])
  const [error, setError] = useState('')
  const [token, setToken] = useState(localStorage.getItem('adminToken') || '')
  const [hasAccess, setHasAccess] = useState(!!localStorage.getItem('adminToken'))
  const [current, setCurrent] = useState(0)

  async function load() {
    try {
      const rows = await api(`/api/queue/list?shopCode=${encodeURIComponent(shopCode)}`, { admin: true })
      setList(rows)
      setError('')
    } catch (e) {
      setError(e.message)
    }
  }

  async function callNext() {
    try {
      const r = await api('/api/queue/next', {
        method: 'POST',
        body: JSON.stringify({ shopCode }),
        admin: true,
      })
      alert(r.ticketNumber ? `Chamando senha: ${r.ticketNumber}` : (r.ticketId ? `Chamando: ${r.ticketId}` : 'Fila vazia'))
      await Promise.all([load(), loadCurrent()])
    } catch (e) {
      setError(e.message)
    }
  }

  useEffect(() => {
    if (!hasAccess) return
    // EventSource para senha atual
    const cur = new EventSource(`${API_BASE}/api/queue/stream/current?shopCode=${encodeURIComponent(shopCode)}`)
    cur.addEventListener('current', (ev) => {
      try { const d = JSON.parse(ev.data); setCurrent(d.currentNumber || 0) } catch {}
    })
    // EventSource para lista (usa token via query)
    const lst = new EventSource(`${API_BASE}/api/queue/stream/list?shopCode=${encodeURIComponent(shopCode)}&token=${encodeURIComponent(token)}`)
    lst.addEventListener('list', (ev) => {
      try { const rows = JSON.parse(ev.data); setList(rows) } catch {}
    })
    return () => { cur.close(); lst.close() }
  }, [hasAccess, shopCode, token])

  function handleLogin(e) {
    e.preventDefault()
    if (!token) return
    localStorage.setItem('adminToken', token)
    setHasAccess(true)
    setError('')
    load()
  }

  function logout() {
    localStorage.removeItem('adminToken')
    setHasAccess(false)
    setList([])
  }

  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold">Painel / Dashboard</h2>
      {!hasAccess ? (
        <form onSubmit={handleLogin} className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm space-y-3 max-w-sm">
          <p className="text-sm text-gray-700">Acesso restrito. Informe o token de administrador.</p>
          <input className="mt-1 w-full rounded-md border-gray-300 shadow-sm focus:border-brand-500 focus:ring-brand-500" value={token} onChange={(e) => setToken(e.target.value)} placeholder="ADMIN_TOKEN" />
          <button className="inline-flex items-center rounded-md bg-brand-600 px-4 py-2 text-white hover:bg-brand-700">Entrar</button>
        </form>
      ) : (
      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div className="text-sm text-gray-600">Senha atual</div>
          <div className="text-3xl font-bold text-gray-900 tabular-nums">{current}</div>
        </div>
        <div className="flex justify-end">
          <button onClick={logout} className="text-xs text-gray-600 hover:text-gray-800">Sair</button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-gray-700">Barbearia (código)</label>
            <input className="mt-1 w-full rounded-md border-gray-300 shadow-sm focus:border-brand-500 focus:ring-brand-500" value={shopCode} onChange={e => setShopCode(e.target.value)} />
          </div>
          <div className="flex items-end gap-2">
            <button onClick={load} className="inline-flex w-full justify-center items-center rounded-md bg-white px-3 py-2 border border-gray-300 text-gray-800 hover:bg-gray-50">Atualizar</button>
            <button onClick={callNext} className="inline-flex w-full justify-center items-center rounded-md bg-brand-600 px-3 py-2 text-white hover:bg-brand-700">Chamar próximo</button>
          </div>
        </div>

        {error && <p className="text-red-600 text-sm">{error}</p>}

        <div className="overflow-hidden rounded-lg border border-gray-200">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Senha</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Cliente</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Serviço</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Entrada</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {list.map(item => (
                <tr key={item.id}>
                  <td className="px-4 py-2 text-sm font-semibold text-gray-900">{item.ticket_number ?? '-'}</td>
                  <td className="px-4 py-2 text-sm text-gray-800">{item.customer_name}</td>
                  <td className="px-4 py-2 text-sm text-gray-600">{item.service_type || '-'}</td>
                  <td className="px-4 py-2 text-sm text-gray-600">{new Date(item.created_at).toLocaleTimeString()}</td>
                </tr>
              ))}
              {list.length === 0 && (
                <tr>
                  <td className="px-4 py-6 text-sm text-gray-500" colSpan={3}>Nenhum cliente na fila.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <p className="text-sm text-gray-600">Exiba este painel em uma TV/monitor com <code className="bg-gray-100 px-1 py-0.5 rounded">#/dashboard</code></p>
      </div>
      )}
    </section>
  )}
