import { useEffect, useState } from 'react'
import { api, API_BASE } from '../api.js'

export default function Dashboard({ shopCode }) {
  const [list, setList] = useState([])
  const [error, setError] = useState('')
  const [current, setCurrent] = useState(0)

  async function callNext() {
    try {
      const r = await api('/api/queue/next', { method: 'POST', body: JSON.stringify({ shopCode }) })
      alert(r.ticketNumber ? `Chamando senha: ${r.ticketNumber}` : (r.ticketId ? `Chamando: ${r.ticketId}` : 'Fila vazia'))
    } catch (e) { setError(e.message) }
  }

  useEffect(() => {
    const cur = new EventSource(`${API_BASE}/api/queue/stream/current?shopCode=${encodeURIComponent(shopCode)}`)
    cur.addEventListener('current', (ev) => { try { const d = JSON.parse(ev.data); setCurrent(d.currentNumber || 0) } catch {} })
    const token = localStorage.getItem('adminToken') || ''
    const lst = new EventSource(`${API_BASE}/api/queue/stream/list?shopCode=${encodeURIComponent(shopCode)}&token=${encodeURIComponent(token)}`)
    lst.addEventListener('list', (ev) => { try { const rows = JSON.parse(ev.data); setList(rows) } catch {} })
    return () => { cur.close(); lst.close() }
  }, [shopCode])

  return (
    <section className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="sm:col-span-2"></div>
        <div className="flex items-end gap-2">
          <button onClick={callNext} className="inline-flex w-full justify-center items-center rounded-md bg-brand-600 px-3 py-2 text-white hover:bg-brand-700">Chamar próximo</button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
        <div className="text-sm text-gray-600">Senha atual</div>
        <div className="text-5xl font-extrabold text-gray-900 tabular-nums">{current}</div>
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Senha</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Cliente</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Serviço</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Entrada</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Chegou?</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {list.map(item => (
              <tr key={item.id}>
                <td className="px-4 py-2 text-sm font-semibold text-gray-900">{item.ticket_number ?? '-'}</td>
                <td className="px-4 py-2 text-sm text-gray-800">{item.customer_name}</td>
                <td className="px-4 py-2 text-sm text-gray-600">{item.service_type || '-'}</td>
                <td className="px-4 py-2 text-sm text-gray-600">{new Date(item.created_at).toLocaleTimeString()}</td>
                <td className="px-4 py-2 text-sm">
                  {item.arrived_at ? <span className="inline-flex items-center rounded-md bg-green-100 px-2 py-0.5 text-green-800">Chegou</span> : <span className="text-gray-400">—</span>}
                </td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr>
                <td className="px-4 py-6 text-sm text-gray-500" colSpan={5}>Nenhum cliente na fila.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {error && <p className="text-red-600 text-sm">{error}</p>}
    </section>
  )
}
