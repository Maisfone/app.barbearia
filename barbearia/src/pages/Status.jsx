import { useEffect, useRef, useState } from 'react'
import { api, API_BASE } from '../api.js'

export default function Status() {
  const [ticketId, setTicketId] = useState(localStorage.getItem('ticketId') || '')
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [paused, setPaused] = useState(false)
  const [pauseMsg, setPauseMsg] = useState('')
  const [showConfirm, setShowConfirm] = useState(false)
  const [graceLeft, setGraceLeft] = useState(null)
  const [alertsOn, setAlertsOn] = useState(false)
  const audioCtxRef = useRef(null)

  async function load() {
    if (!ticketId) return
    try {
      const d = await api(`/api/queue/position/${ticketId}`)
      setData(d)
      setError('')
    } catch (e) {
      setError(e.message)
      setData(null)
    }
  }

  useEffect(() => {
    load()
    const t = setInterval(load, 15000)
    return () => clearInterval(t)
  }, [ticketId])

  // Atualização em tempo real do número atual via SSE após sabermos a loja
  useEffect(() => {
    if (!data?.shopCode) return
    const src = new EventSource(`${API_BASE}/api/queue/stream/current?shopCode=${encodeURIComponent(data.shopCode)}`)
    const onCurrent = (ev) => {
      try {
        const d = JSON.parse(ev.data)
        setData(prev => prev ? { ...prev, currentNumber: d.currentNumber } : prev)
      } catch {}
    }
    src.addEventListener('current', onCurrent)
    // Settings
    const st = new EventSource(`${API_BASE}/api/queue/stream/settings?shopCode=${encodeURIComponent(data.shopCode)}`)
    const onS = (ev) => { try { const s = JSON.parse(ev.data); setPaused(!!s.paused); setPauseMsg(s.pause_message || '') } catch {} }
    st.addEventListener('settings', onS)
    return () => { src.close(); st.close() }
  }, [data?.shopCode])

  // Gerenciar tolerância de 10min quando posição == 2 (fallback via localStorage)
  useEffect(() => {
    if (!ticketId || !data) return
    const key = `graceStart:${ticketId}`
    if (data.position === 2 && (data.status === 'waiting' || data.status === 'called')) {
      let start = localStorage.getItem(key)
      if (!start) {
        start = String(Date.now())
        localStorage.setItem(key, start)
      }
      const compute = () => {
        const s = Number(localStorage.getItem(key) || Date.now())
        const elapsed = Math.floor((Date.now() - s) / 1000)
        const left = Math.max(0, 600 - elapsed)
        setGraceLeft(left)
        if (left === 0) {
          // auto-remover da fila
          handleLeave()
        }
      }
      compute()
      const iv = setInterval(compute, 1000)
      return () => clearInterval(iv)
    } else {
      // Limpar se saiu da posição 2
      setGraceLeft(null)
      try {
        localStorage.removeItem(key)
      } catch {}
    }
  }, [ticketId, data?.position, data?.status])

  async function handleLeave() {
    if (!ticketId) return
    try {
      await api(`/api/queue/${ticketId}/leave`, { method: 'POST' })
      localStorage.removeItem('ticketId')
      localStorage.removeItem('ticketNumber')
      try { localStorage.removeItem(`graceStart:${ticketId}`) } catch {}
      setData(prev => prev ? { ...prev, status: 'canceled' } : prev)
      setError('')
      setShowConfirm(false)
    } catch (e) {
      setError(e.message)
    }
  }

  async function handleArrive() {
    if (!ticketId) return
    try {
      await api(`/api/queue/${ticketId}/arrive`, { method: 'POST' })
      try { localStorage.removeItem(`graceStart:${ticketId}`) } catch {}
      setGraceLeft(null)
    } catch (e) {
      setError(e.message)
    }
  }

  // Alert helpers
  function enableAlerts() {
    setAlertsOn(true)
    try {
      if (!audioCtxRef.current) {
        const Ctx = window.AudioContext || window.webkitAudioContext
        if (Ctx) audioCtxRef.current = new Ctx()
      }
      audioCtxRef.current?.resume?.()
      // Registrar SW e pedir permissão de Notificação
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js').catch(()=>{})
      }
      if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().catch(()=>{})
      }
    } catch {}
  }
  function beep(freq = 880, duration = 200, volume = 0.05) {
    const ctx = audioCtxRef.current
    if (!alertsOn || !ctx) return
    try {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.frequency.value = freq
      gain.gain.value = volume
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start()
      setTimeout(() => { osc.stop(); osc.disconnect(); gain.disconnect() }, duration)
    } catch {}
  }
  // Campainha (chime) com leve decaimento e dois harmônicos
  function playChime() {
    const ctx = audioCtxRef.current
    if (!alertsOn || !ctx) return
    try {
      const now = ctx.currentTime
      const master = ctx.createGain()
      master.gain.setValueAtTime(0.0001, now)
      master.gain.exponentialRampToValueAtTime(0.18, now + 0.01)
      master.gain.exponentialRampToValueAtTime(0.0001, now + 1.2)

      const o1 = ctx.createOscillator() // fundamental
      o1.type = 'sine'
      o1.frequency.setValueAtTime(1200, now)
      o1.frequency.exponentialRampToValueAtTime(880, now + 0.5)

      const o2 = ctx.createOscillator() // harmônico
      o2.type = 'sine'
      o2.frequency.setValueAtTime(1760, now)

      const g2 = ctx.createGain()
      g2.gain.value = 0.35

      o1.connect(master)
      o2.connect(g2)
      g2.connect(master)
      master.connect(ctx.destination)

      o1.start(now)
      o2.start(now)
      o2.stop(now + 0.8)
      o1.stop(now + 1.2)
    } catch {}
  }
  function vibrate(pattern) {
    if (!alertsOn) return
    try { navigator.vibrate && navigator.vibrate(pattern) } catch {}
  }

  // SSE por ticket: atualiza posição/status/grace e dispara alertas
  useEffect(() => {
    if (!ticketId) return
    const es = new EventSource(`${API_BASE}/api/queue/stream/ticket/${encodeURIComponent(ticketId)}`)
    const onTicket = (ev) => {
      try {
        const t = JSON.parse(ev.data)
        setData(prev => {
          // Detectar mudanças para alertas
          const prevPos = prev?.position
          const prevStatus = prev?.status
          const next = { ...(prev || {}), ...t }
          // Alerta de chamado
          if (prevStatus !== 'called' && next.status === 'called') {
            playChime()
            vibrate([200, 120, 200])
          } else if (typeof prevPos === 'number' && typeof next.position === 'number' && next.position < prevPos) {
            // A cada “andar” da fila
            beep(700, 160, 0.05)
            vibrate(100)
          } else if (prevPos !== 2 && next.position === 2) {
            // Chegou na posição de atenção
            beep(850, 220, 0.06)
            vibrate([120, 80, 120])
          }
          return next
        })
      } catch {}
    }
    es.addEventListener('ticket', onTicket)
    return () => es.close()
  }, [ticketId, alertsOn])

  // Push subscribe: quando alertas ativos e temos shop/ticket
  useEffect(() => {
    async function subscribePush() {
      try {
        if (!alertsOn || !ticketId || !data?.shopCode) return
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) return
        if ('Notification' in window && Notification.permission !== 'granted') return
        const reg = await navigator.serviceWorker.ready
        // Buscar VAPID public key
        const keyRes = await fetch(`${API_BASE}/api/push/public-key`)
        const { publicKey } = await keyRes.json()
        if (!publicKey) return
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        })
        await fetch(`${API_BASE}/api/push/subscribe`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ shopCode: data.shopCode, ticketId, subscription: sub }),
        })
      } catch {}
    }
    subscribePush()
  }, [alertsOn, ticketId, data?.shopCode])

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
    const rawData = atob(base64)
    const outputArray = new Uint8Array(rawData.length)
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i)
    }
    return outputArray
  }

  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold">Status do atendimento</h2>
      {paused && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-800">
          {pauseMsg || 'Fila temporariamente pausada'}
        </div>
      )}
      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm space-y-3">
        {ticketId ? (
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-700">Sua senha:&nbsp;
              <span className="inline-flex items-center rounded-md bg-brand-600/10 px-2 py-0.5 font-semibold text-brand-700">{localStorage.getItem('ticketNumber') || '-'}</span>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={enableAlerts} disabled={alertsOn} className={`inline-flex items-center rounded-md px-3 py-2 border text-sm ${alertsOn ? 'bg-white text-gray-500 border-gray-200 cursor-default' : 'bg-white text-gray-800 border-gray-300 hover:bg-gray-50'}`}>
                {alertsOn ? 'Alertas ativos' : 'Ativar alertas'}
              </button>
              {data && data.status === 'waiting' && (
                <button onClick={() => setShowConfirm(true)} className="inline-flex items-center rounded-md bg-red-600 px-4 py-2 text-white hover:bg-red-700">Desistir / Sair da fila</button>
              )}
            </div>
          </div>
        ) : (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700">Cole seu ticket (UUID)</label>
              <input className="mt-1 w-full rounded-md border-gray-300 shadow-sm focus:border-brand-500 focus:ring-brand-500" value={ticketId} onChange={e => setTicketId(e.target.value)} placeholder="cole seu ticket" />
            </div>
            <div className="pt-1">
              <button onClick={load} disabled={!ticketId} className="inline-flex items-center rounded-md bg-brand-600 px-4 py-2 text-white hover:bg-brand-700 disabled:opacity-60">Buscar</button>
            </div>
          </>
        )}
        {error && <p className="text-red-600 text-sm">{error}</p>}
        {data && data.status === 'called' && (
          <div className="rounded-xl border border-green-200 bg-green-50 p-3 text-green-800">
            <div className="font-semibold">Você está sendo chamado</div>
            <div className="text-sm">Dirija-se imediatamente ao atendimento com a sua senha.</div>
          </div>
        )}
        {data && data.position === 2 && (data.status === 'waiting' || data.status === 'called') && (
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-blue-800">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold">Sua vez está chegando</div>
                <div className="text-sm">Dirija-se à barbearia. Tolerância de 10 minutos.</div>
              </div>
              {graceLeft != null && (
                <div className="text-sm font-mono tabular-nums">{String(Math.floor((graceLeft||0)/60)).padStart(2,'0')}:{String((graceLeft||0)%60).padStart(2,'0')}</div>
              )}
            </div>
            <div className="mt-2 flex gap-2">
              <button onClick={handleArrive} className="inline-flex items-center rounded-md bg-green-600 px-3 py-1.5 text-white hover:bg-green-700">Cheguei</button>
            </div>
          </div>
        )}
        {data && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center">
              <div className="rounded-lg p-3 bg-brand-600/10">
                <div className="text-xs font-medium text-brand-700 uppercase tracking-wide">Sua senha</div>
                <div className="text-3xl font-extrabold tabular-nums text-brand-700">{data.ticketNumber ?? localStorage.getItem('ticketNumber') ?? '-'}</div>
              </div>
              <div className="rounded-lg bg-gray-50 p-3">
                <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">Senha atual</div>
                <div className="text-2xl font-bold tabular-nums">{data.currentNumber ?? 0}</div>
              </div>
              <div className={`rounded-lg p-3 ${data.position && data.position <= 2 ? 'bg-amber-50' : 'bg-gray-50'}`}>
                <div className={`text-xs font-medium uppercase tracking-wide ${data.position && data.position <= 2 ? 'text-amber-700' : 'text-gray-500'}`}>Posição</div>
                <div className={`text-2xl font-bold tabular-nums ${data.position && data.position <= 2 ? 'text-amber-700' : ''}`}>{data.position ?? '-'}</div>
              </div>
              <div className={`rounded-lg p-3 ${data.position && data.position <= 2 ? 'bg-amber-50' : 'bg-gray-50'}`}>
                <div className={`text-xs font-medium uppercase tracking-wide ${data.position && data.position <= 2 ? 'text-amber-700' : 'text-gray-500'}`}>À frente</div>
                <div className={`text-2xl font-bold tabular-nums ${data.position && data.position <= 2 ? 'text-amber-700' : ''}`}>{data.position ? data.ahead : '-'}</div>
              </div>
              <div className="rounded-lg bg-gray-50 p-3">
                <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">Estimativa</div>
                <div className="text-2xl font-bold tabular-nums">~{data.estimateMinutes}m</div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm mt-2">
              <div className="rounded-lg bg-gray-50 p-3">
                <div className="text-gray-500">Status</div>
                <div className="text-lg font-semibold capitalize">{data.status}</div>
              </div>
              <div className="rounded-lg bg-gray-50 p-3">
                <div className="text-gray-500">Loja</div>
                <div className="text-lg font-semibold">{data.shopCode}</div>
              </div>
            </div>
          </>
        )}
      </div>
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowConfirm(false)}></div>
          <div className="relative z-10 w-full max-w-md rounded-xl bg-white p-5 shadow-lg border border-gray-200">
            <h3 className="text-lg font-semibold mb-2">Confirmar saída da fila</h3>
            <p className="text-sm text-gray-700">Tem certeza que deseja sair da fila? Você perderá sua vez e terá que pegar uma nova senha.</p>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setShowConfirm(false)} className="inline-flex items-center rounded-md bg-white px-4 py-2 text-gray-800 border border-gray-300 hover:bg-gray-50">Cancelar</button>
              <button onClick={handleLeave} className="inline-flex items-center rounded-md bg-red-600 px-4 py-2 text-white hover:bg-red-700">Confirmar</button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
