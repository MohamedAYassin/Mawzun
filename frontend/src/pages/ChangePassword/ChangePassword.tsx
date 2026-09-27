import { useState } from 'react'
import DashboardLayout from '../../components/DashboardLayout/DashboardLayout'
import { authApi } from '../../lib/api'
import './ChangePassword.css'

interface ChangePasswordProps {
  navigate: (path: string) => void
}

export default function ChangePassword({ navigate }: ChangePasswordProps) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!currentPassword || !newPassword || !confirmPassword) {
      setStatusMsg({ type: 'error', text: 'يرجى ملء جميع الحقول.' })
      return
    }

    if (newPassword.length < 6) {
      setStatusMsg({ type: 'error', text: 'يجب أن تكون كلمة المرور الجديدة مكونة من ٦ أحرف على الأقل.' })
      return
    }

    if (newPassword !== confirmPassword) {
      setStatusMsg({ type: 'error', text: 'كلمة المرور الجديدة وتأكيدها غير متطابقين.' })
      return
    }

    setLoading(true)
    setStatusMsg(null)

    try {
      // The server rotates the security stamp, which invalidates every other
      // session for this account, and hands back a fresh pair for this one.
      await authApi.changePassword({ currentPassword, newPassword })
      setStatusMsg({
        type: 'success',
        text: 'تم تغيير كلمة المرور بنجاح، وتم تسجيل الخروج من باقي الأجهزة.',
      })
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (err: unknown) {
      setStatusMsg({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'حدث خطأ أثناء تغيير كلمة المرور.',
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <DashboardLayout navigate={navigate}>
      <div className="cp-container">
        <div className="cp-header">
          <h1 className="cp-title">تغيير كلمة المرور</h1>
          <p className="cp-subtitle">قم بتحديث كلمة المرور الخاصة بحسابك لحماية إضافية</p>
        </div>

        <div className="cp-card">
          {statusMsg && (
            <div className={`cp-alert cp-alert-${statusMsg.type}`}>
              {statusMsg.text}
            </div>
          )}

          <form onSubmit={handleSubmit} className="cp-form">
            <div className="cp-form-group">
              <label htmlFor="currentPassword">كلمة المرور الحالية</label>
              <input
                type="password"
                id="currentPassword"
                placeholder="أدخل كلمة المرور الحالية"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                disabled={loading}
                required
              />
            </div>

            <div className="cp-form-group">
              <label htmlFor="newPassword">كلمة المرور الجديدة</label>
              <input
                type="password"
                id="newPassword"
                placeholder="أدخل كلمة المرور الجديدة"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                disabled={loading}
                required
              />
            </div>

            <div className="cp-form-group">
              <label htmlFor="confirmPassword">تأكيد كلمة المرور الجديدة</label>
              <input
                type="password"
                id="confirmPassword"
                placeholder="أعد إدخال كلمة المرور الجديدة"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={loading}
                required
              />
            </div>

            <div className="cp-actions">
              <button type="submit" className="cp-btn-submit" disabled={loading}>
                {loading ? 'جاري التحديث...' : 'تغيير كلمة المرور'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </DashboardLayout>
  )
}
