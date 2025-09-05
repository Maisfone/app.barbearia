export const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:4000'

function adminHeaders(headers = {}) {
  const token = localStorage.getItem('adminToken')
  if (token) return { ...headers, Authorization: `Bearer ${token}` }
  return headers
}

export async function api(path, options = {}) {
  const isAdmin = options.admin === true
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) }
  const finalHeaders = isAdmin ? adminHeaders(headers) : headers
  const res = await fetch(`${API_BASE}${path}`, {
    headers: finalHeaders,
    ...options,
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || `Erro ${res.status}`)
  }
  return res.json()
}
