import { useState } from 'react'
import './ForgotPassword.css'
import { authApi } from '../../lib/api'
import Turnstile, { isTurnstileConfigured } from '../../components/Turnstile/Turnstile'

// Password recovery, owner-first.
//
// 1. The form checks the email (forgot-password/check) as soon as it is
//    complete — a tenant is told to ask their owner BEFORE they can submit.
// 2. An owner submitting gets an email with a reset link (valid 24h; one link
//    per 24h even if used).
// 3. A tenant who submits anyway triggers no email — the response just
//    repeats the ask-your-owner message.

interface ForgotPasswordProps {
  navigate: (path: string) => void
}

type Phase = 'idle' | 'checking' | 'ready' | 'sending' | 'sent'

export default function ForgotPassword({ navigate }: ForgotPasswordProps) {
  const [email, setEmail] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [notice, setNotice] = useState<{ kind: 'error' | 'info' | 'success'; text: string } | null>(null)
  const [accountKind, setAccountKind] = useState<'owner' | 'tenant' | 'unknown' | null>(null)
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())

  // Live pre-check: the moment the email looks complete, classify it so a
  // tenant sees the ask-your-owner message before touching the submit button.
  const checkEmail = async (value: string) => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) return
    setPhase('checking')
    try {
      const res = await authApi.forgotPasswordCheck(value.trim())
      setAccountKind(res.accountKind)
      if (res.accountKind === 'tenant') {
        setNotice({ kind: 'info', text: res.message })
      }
      setPhase('ready')
    } catch {
      setPhase('ready')
    }
  }

  const submit = async () => {
    if (!emailValid || phase === 'sending') return
    if (isTurnstileConfigured() && !turnstileToken) {
      setNotice({ kind: 'error', text: 'أكمل التحقق من مكافحة البوت أولاً.' })
      return
    }
    setPhase('sending')
    setNotice(null)
    try {
      const res = await authApi.forgotPassword(email.trim(), turnstileToken ?? undefined)
      setPhase('sent')
      setNotice({
        kind: res.tenant ? 'info' : 'success',
        text: res.tenant ? res.message : 'إذا كان الحساب مؤهلاً، فستصلك رسالة على بريدك الإلكتروني تحتوي على رابط إعادة التعيين خلال دقائق. الرابط صالح ٢٤ ساعة.',
      })
    } catch (err) {
      setPhase('ready')
      setNotice({
        kind: 'error',
        text: err instanceof Error ? err.message : 'تعذر إرسال الطلب. حاول مرة أخرى.',
      })
    }
  }

  const isTenant = accountKind === 'tenant'

  return (
    <div className="split-layout">
      <div className="form-pane">
        <div className="login-card">
          <div className="auth-brand">
            <img src="/logo_scale.svg" alt="Mawzun" />
            <img src="/mawzun_black.svg" alt="mawzun" className="brand-wordmark" />
          </div>

          <h2 className="login-title">استعادة كلمة المرور</h2>
          <p className="login-subtitle">
            أدخل بريدك الإلكتروني وسنتحقق من نوع حسابك.
          </p>

          {notice && (
            <div
              className={
                notice.kind === 'error'
                  ? 'cp-alert cp-alert-error'
                  : notice.kind === 'success'
                    ? 'cp-alert cp-alert-success'
                    : 'cp-alert cp-alert-success'
              }
              style={{ marginBottom: '18px', textAlign: 'right', lineHeight: 1.7 }}
            >
              {notice.text}
            </div>
          )}

          {phase !== 'sent' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div>
                <label htmlFor="fp-email" style={{ display: 'block', marginBottom: '0.4rem' }}>
                  البريد الإلكتروني
                </label>
                <input
                  id="fp-email"
                  type="email"
                  className="cp-input"
                  style={{ width: '100%', direction: 'ltr' }}
                  value={email}
                  placeholder="name@company.com"
                  disabled={phase === 'checking'}
                  onChange={(e) => {
                    setEmail(e.target.value)
                    setAccountKind(null)
                    setNotice(null)
                    if (e.target.value.trim() !== email.trim()) void checkEmail(e.target.value)
                  }}
                  onBlur={(e) => void checkEmail(e.target.value)}
                />
              </div>

              {isTenant && (
                <div className="cp-alert cp-alert-success" style={{ textAlign: 'right', lineHeight: 1.7 }}>
                  هذا الحساب <strong>داخل شركة</strong> — إعادة تعيين كلمة المرور تتم من مالك الشركة
                  أو مدير لديه صلاحية المستخدمين، من شاشة المستخدمين.
                </div>
              )}

              <Turnstile onToken={setTurnstileToken} />
              <button
                type="button"
                className="btn-submit"
                disabled={!emailValid || phase === 'checking' || phase === 'sending' || isTenant}
                onClick={() => void submit()}
              >
                {phase === 'sending' ? 'جاري الإرسال…' : 'إرسال رابط إعادة التعيين'}
              </button>

              {isTenant && (
                <button type="button" className="forgot-btn" onClick={() => navigate('/login')}>
                  فهمت — العودة إلى تسجيل الدخول
                </button>
              )}

              <button type="button" className="forgot-btn" onClick={() => navigate('/login')} disabled={isTenant}>
                العودة إلى تسجيل الدخول
              </button>
            </div>
          )}

          {phase === 'sent' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <button type="button" className="btn-submit" onClick={() => navigate('/login')}>
                العودة إلى تسجيل الدخول
              </button>
            </div>
          )}

          <button
            type="button"
            className="forgot-btn"
            style={{ marginTop: '0.75rem' }}
            onClick={() => navigate('/register')}
          >
            ليس لديك حساب؟ أنشئ مساحة عمل جديدة
          </button>
        </div>
      </div>

      {/* Visual Pane */}
      <div className="visual-pane">
        <div className="visual-header-wrapper">
          <div className="visual-logo">
            <img src="/mawzun_black.svg" alt="mawzun" className="brand-wordmark" />
          </div>
          <h1 className="visual-heading">إدارة المبيعات والمخازن والعمليات في مكان واحد</h1>
        </div>

        <div className="visual-illustration-wrapper">
          <img className="visual-illustration" src="/logo_scale.svg" alt="Mawzun" />
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
