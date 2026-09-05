import * as realApi from './realApi'
import * as mockApi from './mockApi'

export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')
export const POLL_INTERVAL_MS = Number(import.meta.env.VITE_POLL_INTERVAL_MS || 2000)
export const MAX_UPLOAD_SIZE_MB = Number(import.meta.env.VITE_MAX_UPLOAD_SIZE_MB || 500)

const useMock = String(import.meta.env.VITE_USE_MOCK_API).toLowerCase() === 'true'
const implementation = useMock ? mockApi : realApi

export const createJob = implementation.createJob
export const getJobStatus = implementation.getJobStatus
export const getJobResults = implementation.getJobResults
export { useMock }

export function resolveApiUrl(value) {
  if (!value) return null
  if (/^https?:\/\//i.test(value)) {
    try {
      const result = new URL(value)
      const backend = new URL(API_BASE_URL)
      // Vite proxies /api in development. Production has no Vite proxy, so it
      // must retain the configured backend origin.
      if (import.meta.env.DEV && result.origin === backend.origin && result.pathname.startsWith('/api/')) return `${result.pathname}${result.search}`
    } catch { /* Return the original value below. */ }
    return value
  }
  if (value.startsWith('blob:') || value.startsWith('data:')) return value
  if (import.meta.env.DEV && value.startsWith('/api/')) return value
  return `${API_BASE_URL}${value.startsWith('/') ? '' : '/'}${value}`
}

export function readableError(error) {
  if (typeof error === 'string') return error
  const detail = error?.detail
  if (typeof detail === 'string') return detail
  if (detail?.message) return detail.message
  return error?.message || 'The server could not complete this request.'
}
