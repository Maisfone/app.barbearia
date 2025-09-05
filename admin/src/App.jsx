import { useEffect, useState } from 'react'
import Dashboard from './pages/Dashboard.jsx'
import Settings from './pages/Settings.jsx'

function getRoute() {
  const h = window.location.hash || '#/dashboard'
  if (h.startsWith('#/settings')) return 'settings'
  return 'dashboard'
}

export default function App() {
  const [route, setRoute] = useState(getRoute())
  const [token, setToken] = useState(localStorage.getItem('adminToken') || '')
  const [hasAccess, setHasAccess] = useState(!!localStorage.getItem('adminToken'))
  const [shopCode, setShopCode] = useState(import.meta.env.VITE_DEFAULT_SHOP || 'dersobarbearia')

  useEffect(() => {
    const onHash = () => setRoute(getRoute())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  function handleLogin(e) {
    e.preventDefault()
    if (!token) return
    localStorage.setItem('adminToken', token)
    setHasAccess(true)
  }

  function logout() {
    localStorage.removeItem('adminToken')
    setHasAccess(false)
  }

  return (
    <div className="mx-auto max-w-5xl p-4 space-y-4">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-semibold">Painel Admin — Barbearia</h1>
          <nav className="flex gap-2 text-sm">
            <a href="#/dashboard" className={`px-3 py-1.5 rounded-md border ${route==='dashboard' ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-100'}`}>Painel</a>
            <a href="#/settings" className={`px-3 py-1.5 rounded-md border ${route==='settings' ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-100'}`}>Configuração</a>
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-700">Barbearia:</label>
          <input className="w-56 rounded-md border-gray-300 shadow-sm focus:border-brand-500 focus:ring-brand-500" value={shopCode} onChange={e => setShopCode(e.target.value)} />
          {hasAccess ? (
            <button onClick={logout} className="text-xs text-gray-600 hover:text-gray-800">Sair</button>
          ) : null}
        </div>
      </header>

      {!hasAccess ? (
        <form onSubmit={handleLogin} className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm space-y-3 max-w-sm">
          <p className="text-sm text-gray-700">Informe o token de administrador</p>
          <input className="mt-1 w-full rounded-md border-gray-300 shadow-sm focus:border-brand-500 focus:ring-brand-500" value={token} onChange={(e) => setToken(e.target.value)} placeholder="ADMIN_TOKEN" />
          <button className="inline-flex items-center rounded-md bg-brand-600 px-4 py-2 text-white hover:bg-brand-700">Entrar</button>
        </form>
      ) : (
        <main>
          {route === 'dashboard' && <Dashboard shopCode={shopCode} />}
          {route === 'settings' && <Settings shopCode={shopCode} />}
        </main>
      )}
    </div>
  )
}
