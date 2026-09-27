import { useState } from 'react'
import './ResetPassword.css'
import { authApi } from '../../lib/api'

// Consumes the emailed reset token (?token=...) and sets the new password.
// Reachable from the link in the owner's reset email — valid 24h, single use.

interface ResetPasswordProps {
  navigate: (path: string) => void
}

export default function ResetPassword({ navigate }: ResetPasswordProps) {
  const [token] = useState(() => new URLSearchParams(window.location.search).get('token') ?? '')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'error' | 'success'; text: string } | null>(null)

  const submit = async () => {
    if (saving) return
    if (password.length < 8) {
      setNotice({ kind: 'error', text: 'كلمة المرور يجب ألا تقل عن ٨ أحرف.' })
      return
    }
    if (password !== confirm) {
      setNotice({ kind: 'error', text: 'كلمتا المرور غير متطابقتين.' })
      return
    }
    setSaving(true)
    setNotice(null)
    try {
      await authApi.resetPassword(token, password)
      setNotice({ kind: 'success', text: 'تم تعيين كلمة المرور بنجاح. يمكنك تسجيل الدخول الآن.' })
      setTimeout(() => navigate('/login'), 1800)
    } catch (err) {
      setNotice({
        kind: 'error',
        text: err instanceof Error ? err.message : 'تعذر تعيين كلمة المرور.',
      })
    } finally {
      setSaving(false)
    }
  }

  if (!token) {
    return (
      <div className="split-layout">
        <div className="form-pane">
          <div className="login-card">
            <h2 className="login-title">رابط غير صالح</h2>
            <p className="login-subtitle">لا يوجد رمز إعادة تعيين في الرابط.</p>
            <button type="button" className="btn-submit" onClick={() => navigate('/forgot-password')}>
              طلب رابط جديد
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="split-layout">
      <div className="form-pane">
        <div className="login-card">
          <div className="auth-brand">
            <img src="/logo_scale.svg" alt="Mawzun" />
            <img src="/mawzun_black.svg" alt="mawzun" className="brand-wordmark" />
          </div>

          <h2 className="login-title">تعيين كلمة مرور جديدة</h2>
          <p className="login-subtitle">اختر كلمة مرور قوية لحسابك.</p>

          {notice && (
            <div
              className={notice.kind === 'error' ? 'cp-alert cp-alert-error' : 'cp-alert cp-alert-success'}
              style={{ marginBottom: '18px', textAlign: 'right', lineHeight: 1.7 }}
            >
              {notice.text}
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div>
              <label htmlFor="rp-pass" style={{ display: 'block', marginBottom: '0.4rem' }}>
                كلمة المرور الجديدة
              </label>
              <input
                id="rp-pass"
                type="password"
                className="cp-input"
                style={{ width: '100%' }}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="rp-confirm" style={{ display: 'block', marginBottom: '0.4rem' }}>
                تأكيد كلمة المرور
              </label>
              <input
                id="rp-confirm"
                type="password"
                className="cp-input"
                style={{ width: '100%' }}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
            <button type="button" className="btn-submit" disabled={saving} onClick={() => void submit()}>
              {saving ? 'جاري الحفظ…' : 'تعيين كلمة المرور'}
            </button>
            <button type="button" className="forgot-btn" onClick={() => navigate('/login')}>
              العودة إلى تسجيل الدخول
            </button>
          </div>
        </div>
      </div>

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
      </div>
    </div>
  )
}
