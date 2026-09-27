import { useEffect, useState, FormEvent } from 'react'
import { authApi, session } from '../../lib/api'
import Turnstile, { isTurnstileConfigured } from '../../components/Turnstile/Turnstile'
import './Login.css'

interface LoginProps {
  navigate: (path: string) => void
}

function Login({ navigate }: LoginProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [rememberMe, setRememberMe] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)

  // Belt and suspenders next to the `_public` route guard: a signed-in visitor
  // who lands here (typed URL, back button, stale bundle without the guard)
  // goes straight to the dashboard instead of staring at a login form. The
  // token in storage can be dead, so verify with the server first — and clear
  // it when the server refuses, or the guards would just ping-pong.
  useEffect(() => {
    if (!session.isAuthenticated) return
    let alive = true
    authApi.me().then(
      () => { if (alive) navigate('/dashboard') },
      () => { session.clear() },
    )
    return () => { alive = false }
  }, [navigate])

  const handleLoginSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (isTurnstileConfigured() && !turnstileToken) {
      setError('أكمل التحقق من مكافحة البوت أولاً.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      // The client stores the token pair itself; the rest of the principal
      // (company, permissions, ownership) is fetched when something asks for
      // it, so it can never be a stale copy.
      await authApi.login({ email, password, rememberMe, turnstileToken: turnstileToken ?? undefined })
      // Honor the ?redirect= the guard attached when it bounced the visitor
      // here, so a deep link survives the login detour. Fall back to the
      // dashboard, and never redirect back to the login page itself.
      const params = new URLSearchParams(window.location.search)
      const target = params.get('redirect')
      navigate(target && target.startsWith('/') && !target.startsWith('/login') ? target : '/dashboard')
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : 'فشل تسجيل الدخول. يرجى التحقق من بيانات الاعتماد والمحاولة مرة أخرى.'
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="split-layout">
      {/* Form Pane */}
      <div className="form-pane">
        <div className="login-card">
          <div className="auth-brand">
            <img src="/logo_scale.svg" alt="Mawzun" />
            <img src="/mawzun_black.svg" alt="mawzun" className="brand-wordmark" />
          </div>

          <h2 className="login-title">تسجيل الدخول</h2>
          <p className="login-subtitle">أدخل بياناتك للوصول إلى نظام <img src="/mawzun_black.svg" alt="موزون" className="brand-inline" /> لإدارة موارد المؤسسة (ERP)</p>

          {error && (
            <div 
              className="login-error-message" 
              style={{ 
                color: 'var(--color-danger)', 
                background: 'rgba(140, 61, 38, 0.08)', 
                border: '1px solid rgba(140, 61, 38, 0.15)',
                padding: '10px 14px', 
                borderRadius: 'var(--radius-md)', 
                marginBottom: '18px', 
                fontSize: '0.85rem', 
                textAlign: 'right' 
              }}
            >
              {error}
            </div>
          )}

          <form className="login-form" onSubmit={handleLoginSubmit}>
            <div className="form-group">
              <label htmlFor="email">البريد الإلكتروني</label>
              <input 
                type="email" 
                id="email" 
                className="form-input" 
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com" 
                required 
                disabled={loading}
              />
            </div>

            <div className="form-group">
              <label htmlFor="password">كلمة المرور</label>
              <input 
                type="password" 
                id="password" 
                className="form-input" 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••" 
                required 
                disabled={loading}
              />
            </div>

            <div className="options-row">
              <label className="remember-label">
                <input 
                  type="checkbox" 
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  disabled={loading} 
                />
                <span>تذكرني</span>
              </label>
              <button type="button" className="forgot-btn" onClick={() => navigate('/forgot-password')} disabled={loading}>
                نسيت كلمة المرور؟
              </button>
            </div>

            <Turnstile onToken={setTurnstileToken} />

            <button type="submit" className="btn-submit" disabled={loading}>
              {loading ? 'جاري التحميل...' : 'تسجيل الدخول'}
            </button>
            <button type="button" className="forgot-btn" style={{ marginTop: '0.75rem' }} onClick={() => navigate('/register')} disabled={loading}>
              ليس لديك حساب؟ أنشئ مساحة عمل جديدة
            </button>
          </form>
        </div>
      </div>

      {/* Visual Pane */}
      <div className="visual-pane">
        <div className="visual-header-wrapper">
          <div className="visual-logo"><img src="/mawzun_black.svg" alt="mawzun" className="brand-wordmark" /></div>
          <h1 className="visual-heading">
            نظام ERP متكامل لإدارة مبيعاتك ومخزونك وعملياتك
          </h1>
        </div>

        <div className="visual-illustration-wrapper">
          <img
            className="visual-illustration"
            src="/logo_scale.svg"
            alt="Mawzun Logo"
          />
        </div>

        <div>
          <p className="visual-footer-text">
            من المبيعات والمخزون إلى الإنتاج والشحن والمحاسبة: كل عمليات مؤسستك في مكان واحد.
          </p>
        </div>
      </div>
    </div>
  )
}

export default Login
