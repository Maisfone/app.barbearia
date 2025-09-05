import { useEffect, useState } from 'react'
import { api, API_BASE } from '../api.js'

export default function Settings({ shopCode }) {
  const [services, setServices] = useState([])
  const [svcName, setSvcName] = useState('')
  const [svcDur, setSvcDur] = useState('')
  const [paused, setPaused] = useState(false)
  const [pauseMsg, setPauseMsg] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    loadServices()
    const st = new EventSource(`${API_BASE}/api/queue/stream/settings?shopCode=${encodeURIComponent(shopCode)}`)
    st.addEventListener('settings', (ev) => {
      try { const s = JSON.parse(ev.data); setPaused(!!s.paused); setPauseMsg(s.pause_message || '') } catch {}
    })
    return () => st.close()
  }, [shopCode])

  async function loadServices() {
    try { const rows = await fetch(`${API_BASE}/api/services?shopCode=${encodeURIComponent(shopCode)}`).then(r => r.json()); setServices(rows) } catch {}
  }

  async function addService(e) {
    e.preventDefault()
    try {
      await api('/api/services', { method: 'POST', body: JSON.stringify({ shopCode, name: svcName, durationMinutes: svcDur ? Number(svcDur) : undefined }) })
      setSvcName(''); setSvcDur(''); loadServices()
    } catch (e) { setError(e.message) }
  }

  async function removeService(id) {
    try { await api(`/api/services/${id}`, { method: 'DELETE' }); loadServices() } catch (e) { setError(e.message) }
  }

  async function savePause(e) {
    e.preventDefault()
    try { await api('/api/shop/settings', { method: 'POST', body: JSON.stringify({ shopCode, paused, pauseMessage: pauseMsg || null }) }) } catch (e) { setError(e.message) }
  }

  return (
    <section className="space-y-4">
      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
        <h2 className="text-lg font-semibold mb-2">Pausa da fila</h2>
        <form onSubmit={savePause} className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={paused} onChange={e => setPaused(e.target.checked)} />
            Pausar fila
          </label>
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-gray-700">Mensagem ao cliente (ex.: Almoço, Feriado, Encerrado)</label>
            <input className="mt-1 w-full rounded-md border-gray-300 shadow-sm focus:border-brand-500 focus:ring-brand-500" value={pauseMsg} onChange={e => setPauseMsg(e.target.value)} placeholder="Ex.: Almoço - retornamos às 14h" />
          </div>
          <div>
            <button className="inline-flex items-center rounded-md bg-brand-600 px-4 py-2 text-white hover:bg-brand-700">Salvar</button>
          </div>
        </form>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm space-y-3">
        <h2 className="text-lg font-semibold">Serviços</h2>
        <form onSubmit={addService} className="grid grid-cols-1 sm:grid-cols-5 gap-3 items-end">
          <div className="sm:col-span-3">
            <label className="block text-sm font-medium text-gray-700">Nome</label>
            <input className="mt-1 w-full rounded-md border-gray-300 shadow-sm focus:border-brand-500 focus:ring-brand-500" value={svcName} onChange={e => setSvcName(e.target.value)} placeholder="Ex.: Corte, Barba" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Duração (min)</label>
            <input type="number" min="1" className="mt-1 w-full rounded-md border-gray-300 shadow-sm focus:border-brand-500 focus:ring-brand-500" value={svcDur} onChange={e => setSvcDur(e.target.value)} placeholder="Opcional" />
          </div>
          <div>
            <button className="inline-flex items-center rounded-md bg-brand-600 px-4 py-2 text-white hover:bg-brand-700">Adicionar</button>
          </div>
        </form>
        <div className="overflow-hidden rounded-lg border border-gray-200">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Nome</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Duração</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {services.map(s => (
                <tr key={s.id}>
                  <td className="px-4 py-2 text-sm text-gray-800">{s.name}</td>
                  <td className="px-4 py-2 text-sm text-gray-600">{s.duration_minutes ?? '-'}</td>
                  <td className="px-4 py-2 text-right"><button onClick={() => removeService(s.id)} className="text-sm text-red-600 hover:text-red-800">Remover</button></td>
                </tr>
              ))}
              {services.length === 0 && (
                <tr><td className="px-4 py-4 text-sm text-gray-500" colSpan={3}>Nenhum serviço cadastrado.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {error && <p className="text-red-600 text-sm">{error}</p>}
    </section>
  )
}

