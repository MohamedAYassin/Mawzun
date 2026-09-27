import { useEffect, useState } from 'react'
import { authApi, session } from '../../lib/api'
import Turnstile, { isTurnstileConfigured } from '../../components/Turnstile/Turnstile'
import '../../styles/Auth.css'

interface RegisterProps {
  navigate: (path: string) => void
}

export default function Register({ navigate }: RegisterProps) {
  const [companyName, setCompanyName] = useState('')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)

  // Same already-signed-in redirect as Login: verify, go to the dashboard,
  // or drop a dead token so the guards stop ping-ponging.
  useEffect(() => {
    if (!session.isAuthenticated) return
    let alive = true
    authApi.me().then(
      () => { if (alive) navigate('/dashboard') },
      () => { session.clear() },
    )
    return () => { alive = false }
  }, [navigate])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError('')
    if (password !== confirmPassword) {
      setError('كلمتا المرور غير متطابقتين.')
      return
    }
    if (isTurnstileConfigured() && !turnstileToken) {
      setError('أكمل التحقق من مكافحة البوت أولاً.')
      return
    }
    setLoading(true)
    try {
      // Registering also creates the company: the caller becomes its single
      // owner, which the database enforces. There is no separate "create a
      // workspace" step and there should not be one.
      await authApi.signup({
        companyName,
        fullName,
        email,
        password,
        phoneNumber: phoneNumber || undefined,
        turnstileToken: turnstileToken ?? undefined,
      })
      navigate('/dashboard')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إنشاء الحساب.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-page" dir="rtl">
      <div className="auth-card">
        <div className="auth-brand">
          <img src="/logo_scale.svg" alt="Mawzun" />
          <img src="/mawzun_black.svg" alt="mawzun" className="brand-wordmark" />
        </div>

        <h1 className="login-title">إنشاء حساب جديد</h1>
        <p className="login-subtitle">أنشئ مساحة عمل خاصة بك — بياناتك معزولة تماماً عن باقي العملاء.</p>

        {error && <div className="auth-error">{error}</div>}

        <form onSubmit={submit} className="auth-form">
          <label className="auth-field">
            اسم الشركة / النشاط
            <input className="ss-input" value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder="مثال: متجر النور" required />
          </label>
          <label className="auth-field">
            الاسم الكامل
            <input className="ss-input" value={fullName} onChange={e => setFullName(e.target.value)} required />
          </label>
          <label className="auth-field">
            البريد الإلكتروني
            <input className="ss-input" type="email" value={email} onChange={e => setEmail(e.target.value)} required />
          </label>
          <label className="auth-field">
            رقم الهاتف (اختياري)
            <input className="ss-input" value={phoneNumber} onChange={e => setPhoneNumber(e.target.value)} />
          </label>
          <div className="auth-form-row">
            <label className="auth-field">
              كلمة المرور
              <input className="ss-input" type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={6} />
            </label>
            <label className="auth-field">
              تأكيد كلمة المرور
              <input className="ss-input" type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required minLength={6} />
            </label>
          </div>
          <Turnstile onToken={setTurnstileToken} />
          <button type="submit" className="btn-submit" disabled={loading}>
            {loading ? 'جاري إنشاء الحساب...' : 'إنشاء الحساب والبدء'}
          </button>
        </form>

        <p className="auth-alt">
          لديك حساب بالفعل؟{' '}
          <a href="/login" onClick={e => { e.preventDefault(); navigate('/login') }}>تسجيل الدخول</a>
        </p>
      </div>
    </div>
  )
}

