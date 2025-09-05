import JoinQueue from './pages/JoinQueue.jsx'
import Status from './pages/Status.jsx'
import { useEffect, useState } from 'react'

function getRoute() {
  const hash = window.location.hash || '#/join'
  if (hash.startsWith('#/status')) return 'status'
  return 'join'
}

function getParam(name) {
  const url = new URL(window.location.href)
  const fromSearch = url.searchParams.get(name)
  if (fromSearch) return fromSearch
  const hash = window.location.hash || ''
  const qIndex = hash.indexOf('?')
  if (qIndex !== -1) {
    const qs = new URLSearchParams(hash.slice(qIndex + 1))
    return qs.get(name)
  }
  return null
}

export default function App() {
  const [route, setRoute] = useState(getRoute())
  useEffect(() => {
    const onHash = () => setRoute(getRoute())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      {getParam('kiosk') !== '1' && (
        <header className="mb-6">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-semibold">Fila Barbearia</h1>
            <nav className="flex gap-3 text-sm">
              <a href="#/join" className={`px-3 py-1.5 rounded-md border ${route==='join' ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-100'}`}>Entrar</a>
              <a href="#/status" className={`px-3 py-1.5 rounded-md border ${route==='status' ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-100'}`}>Status</a>
            </nav>
          </div>
        </header>
      )}

      <main>
        {route === 'join' && <JoinQueue />}
        {route === 'status' && <Status />}
      </main>
    </div>
  )
}
