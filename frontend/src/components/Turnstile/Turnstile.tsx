import { useEffect, useRef, useState } from 'react'

// Cloudflare Turnstile bot check without adding a dependency.
// Renders the managed widget when VITE_TURNSTILE_SITE_KEY is set; renders
// nothing (and yields no token) when unset, which is the local-dev path —
/// the backend only enforces the token when TURNSTILE_SECRET is configured.

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string
      reset: (id?: string) => void
      remove?: (id: string) => void
    }
    __turnstileLoading?: Promise<void>
  }
}

const SITE_KEY = (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined) ?? ''

function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve()
  if (!window.__turnstileLoading) {
    window.__turnstileLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script')
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
      s.async = true
      s.onload = () => resolve()
      s.onerror = () => reject(new Error('turnstile load failed'))
      document.head.appendChild(s)
    })
  }
  return window.__turnstileLoading
}

export function isTurnstileConfigured(): boolean {
  return SITE_KEY.length > 0
}

export default function Turnstile({ onToken }: { onToken: (token: string | null) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const cb = useRef(onToken)
  cb.current = onToken
  const [blocked, setBlocked] = useState(false)

  useEffect(() => {
    if (!SITE_KEY || !ref.current) return
    let id = ''
    let alive = true
    loadScript()
      .then(() => {
        if (!alive || !ref.current || !window.turnstile) return
        id = window.turnstile.render(ref.current, {
          sitekey: SITE_KEY,
          callback: (t: string) => cb.current(t),
          'expired-callback': () => cb.current(null),
          'error-callback': () => cb.current(null),
        })
      })
      .catch(() => {
        // Almost always an adblocker eating challenges.cloudflare.com.
        if (alive) setBlocked(true)
        cb.current(null)
      })
    return () => {
      alive = false
      try {
        if (id && window.turnstile?.remove) window.turnstile.remove(id)
        else if (id) window.turnstile?.reset(id)
      } catch {
        // Widget teardown is best-effort; a stale iframe harms nothing.
      }
    }
  }, [])

  if (!SITE_KEY) return null
  if (blocked) {
    return (
      <div style={{ margin: '0.75rem 0', padding: '0.7rem 0.9rem', borderRadius: 8, background: 'rgba(140,61,38,.08)', border: '1px solid rgba(140,61,38,.2)', fontSize: '.82rem', color: '#8C3D26' }}>
        تعذّر تحميل التحقق من مكافحة البوت — غالباً مانع الإعلانات يحجبه. عطّله لهذا الموقع ثم حدّث الصفحة.
      </div>
    )
  }
  return <div ref={ref} style={{ margin: '0.75rem 0' }} />
}
