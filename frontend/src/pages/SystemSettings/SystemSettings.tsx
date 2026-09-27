import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import DashboardLayout from '../../components/DashboardLayout/DashboardLayout'
import { authApi, usersApi, rolesApi, sessionsApi, type ActiveSession, type CompanyUser, type SessionList } from '../../lib/api'
import { useCurrentUser } from '../../hooks/useCurrentUser'
import { describeDevice, formatMoment } from '../../lib/device'
import { Select } from '../../components/Select/Select'
import { useFilePicker } from '../../lib/useImageUpload'
import BrandsManagement from '../BrandsManagement/BrandsManagement'
import CategoriesManagement from '../CategoriesManagement/CategoriesManagement'
import WarehousesManagement from '../WarehousesManagement/WarehousesManagement'
import GovernoratesManagement from '../GovernoratesManagement/GovernoratesManagement'
import CitiesManagement from '../CitiesManagement/CitiesManagement'
import OrderSourcesManagement from '../OrderSourcesManagement/OrderSourcesManagement'
import PaymentMethodsManagement from '../PaymentMethodsManagement/PaymentMethodsManagement'
import ShippingCompaniesManagement from '../ShippingCompaniesManagement/ShippingCompaniesManagement'
import SettingsSection from '../../components/CompanySettings/SettingsSection'
import { findSection } from '../../components/CompanySettings/settingsSections'
import './SystemSettings.css'

interface SystemSettingsProps {
  navigate: (path: string) => void
}

type Tab =
  | 'account'
  | 'register'
  | 'admin-reset'
  | 'set-company'
  | 'set-accounting'
  | 'set-inventory'
  | 'set-purchases'
  | 'set-sales'
  | 'set-shipping'
  | 'governorates'
  | 'cities'
  | 'order-sources'
  | 'payment-methods'
  | 'shipping-companies'
  | 'brands'
  | 'categories'
  | 'warehouses'
  | 'revoke-token'


type Notice = {
  type: 'success' | 'error' | 'info'
  text: string
}

function Icon({ children, size = 18 }: { children: ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  )
}

const CheckIcon = () => <Icon size={16}><path d="m5 12 4 4L19 6" /></Icon>
const AlertIcon = () => <Icon size={16}><path d="M12 9v4M12 17h.01" /><path d="M10.3 4.4 2.6 18a1.4 1.4 0 0 0 1.2 2h16.4a1.4 1.4 0 0 0 1.2-2L13.7 4.4a2 2 0 0 0-3.4 0Z" /></Icon>
const InfoIcon = () => <Icon size={16}><circle cx="12" cy="12" r="9" /><path d="M12 10v6M12 7h.01" /></Icon>
const UserIcon = () => <Icon><path d="M20 21a8 8 0 0 0-16 0" /><circle cx="12" cy="7" r="4" /></Icon>
const UserPlusIcon = () => <Icon><path d="M15 21a6 6 0 0 0-12 0" /><circle cx="9" cy="7" r="4" /><path d="M19 8v6M16 11h6" /></Icon>
const KeyIcon = () => <Icon><circle cx="8" cy="15" r="4" /><path d="m11 12 9-9M17 6l2 2M14 9l2 2" /></Icon>
const ShieldIcon = () => <Icon><path d="M12 3 20 6v5c0 5-3.3 8.7-8 10-4.7-1.3-8-5-8-10V6l8-3Z" /><path d="m9 12 2 2 4-4" /></Icon>
const MapPinIcon = () => <Icon><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></Icon>
const MapIcon = () => <Icon><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Z" /><path d="M9 3v15M15 6v15" /></Icon>
const GlobeIcon = () => <Icon><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></Icon>
const CreditCardIcon = () => <Icon><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18M7 15h4" /></Icon>
const TruckIcon = () => <Icon><path d="M3 6h11v10H3zM14 10h4l3 3v3h-7z" /><circle cx="7" cy="18" r="2" /><circle cx="18" cy="18" r="2" /></Icon>
const TagIcon = () => <Icon><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" /><line x1="7" y1="7" x2="7.01" y2="7" /></Icon>
const LayersIcon = () => <Icon><polygon points="12 2 2 7 12 12 22 7 12 2" /><polygon points="2 17 12 22 22 17" /><polygon points="2 12 12 17 22 12" /></Icon>
const HomeIcon = () => <Icon><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></Icon>
function StatusBanner({ notice }: { notice: Notice | null }) {
  if (!notice) return null

  return (
    <div className={`ss-status ss-status-${notice.type}`} role={notice.type === 'error' ? 'alert' : 'status'}>
      <span className="ss-status-icon">
        {notice.type === 'success' ? <CheckIcon /> : notice.type === 'error' ? <AlertIcon /> : <InfoIcon />}
      </span>
      <span>{notice.text}</span>
    </div>
  )
}

function Button({
  children,
  variant = 'primary',
  type = 'button',
  onClick,
  disabled = false,
  className = '',
}: {
  children: ReactNode
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  type?: 'button' | 'submit'
  onClick?: () => void
  disabled?: boolean
  className?: string
}) {
  return (
    <button type={type} className={`ss-button ss-button-${variant} ${className}`} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  )
}

function AccountTab() {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [picUrl, setPicUrl] = useState(() => localStorage.getItem('profilePictureUrl') || '')
  const [picLoading, setPicLoading] = useState(false)

  // Picking a file stores it in R2 and saves the returned asset address.
  const picPicker = useFilePicker((url) => {
    if (url) {
      setPicUrl(url)
      void savePicRef.current?.(url)
    }
  })
  const savePicRef = useRef<((url?: string) => Promise<void>) | null>(null)

  const saveProfilePicture = async (nextUrl = picUrl) => {
    setPicLoading(true)
    setNotice(null)
    try {
      // The profile picture is a field on the caller's user record; the
      // principal supplies the id.
      const me = await authApi.me()
      const saved = await usersApi.update(me.user.id, { avatarUrl: nextUrl.trim() || null })
      localStorage.setItem('profilePictureUrl', saved.avatarUrl || '')
      window.dispatchEvent(new Event('profile-picture-changed'))
      setNotice({ type: 'success', text: saved ? 'تم تحديث صورة الحساب بنجاح.' : 'تم حذف صورة الحساب.' })
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'تعذر تحديث صورة الحساب.' })
    } finally {
      setPicLoading(false)
    }
  }

  savePicRef.current = saveProfilePicture

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!currentPassword || !newPassword || !confirmPassword) return setNotice({ type: 'error', text: 'يرجى ملء جميع الحقول.' })
    if (newPassword.length < 6) return setNotice({ type: 'error', text: 'يجب أن تتكون كلمة المرور الجديدة من ٦ أحرف على الأقل.' })
    if (newPassword !== confirmPassword) return setNotice({ type: 'error', text: 'كلمة المرور الجديدة وتأكيدها غير متطابقين.' })
    setLoading(true)
    setNotice(null)
    try {
      await authApi.changePassword({ currentPassword, newPassword })
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setNotice({ type: 'success', text: 'تم تغيير كلمة المرور بنجاح.' })
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'تعذر تغيير كلمة المرور.' })
    } finally {
      setLoading(false)
    }
  }

  return <section className="ss-module ss-account-module animate-fade-in"><div className="ss-module-heading"><div className="ss-module-icon"><UserIcon /></div><div><p className="ss-eyebrow">الأمان الشخصي</p><h2>إعدادات الحساب</h2><p>صورة حسابك بكلمة مرورك — محفوظة مع بياناتك.</p></div></div><StatusBanner notice={notice} /><div className="ss-account-form" style={{ marginBottom: '1.25rem' }}><div className="ss-form-field ss-form-field-full"><label htmlFor="profile-picture-file">صورة الحساب</label><div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}><div style={{ width: 44, height: 44, borderRadius: '50%', overflow: 'hidden', flexShrink: 0, background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{picUrl.trim() ? <img src={picUrl.trim()} alt="صورة الحساب" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} /> : <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>—</span>}</div><span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>اختر صورة من جهازك لتظهر بجانب اسمك.</span></div></div><div className="ss-form-actions"><input id="profile-picture-file" ref={picPicker.inputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => void picPicker.onChange(e)} /><Button onClick={picPicker.openPicker} disabled={picPicker.uploading || picLoading}>{picPicker.uploading ? 'جاري الرفع...' : 'اختيار صورة'}</Button><Button onClick={() => void saveProfilePicture()} disabled={picLoading || !picUrl.trim()}>{picLoading ? 'جاري الحفظ...' : 'حفظ الصورة'}</Button></div></div><form className="ss-account-form" onSubmit={submit}><div className="ss-form-field"><label htmlFor="current-password">كلمة المرور الحالية</label><input id="current-password" type="password" className="ss-input" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} disabled={loading} autoComplete="current-password" /></div><div className="ss-form-field"><label htmlFor="new-password">كلمة المرور الجديدة</label><input id="new-password" type="password" className="ss-input" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} disabled={loading} autoComplete="new-password" /></div><div className="ss-form-field"><label htmlFor="confirm-password">تأكيد كلمة المرور الجديدة</label><input id="confirm-password" type="password" className="ss-input" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} disabled={loading} autoComplete="new-password" /></div><div className="ss-form-actions"><Button type="submit" disabled={loading}>{loading ? 'جاري الحفظ...' : 'تغيير كلمة المرور'}</Button></div></form></section>
}

function RegisterTab() {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [role, setRole] = useState('Admin')
  const [roles, setRoles] = useState<string[]>(['Admin'])
  const [loading, setLoading] = useState(false)
  const [rolesLoading, setRolesLoading] = useState(true)
  const [notice, setNotice] = useState<Notice | null>(null)

  useEffect(() => {
    let mounted = true
    void rolesApi.list({ pageSize: 100 }).then((page) => {
      if (!mounted) return
      const names = page.items.map((group) => group.name).filter(Boolean)
      const availableRoles = names.includes('ADMIN') ? names : ['ADMIN', ...names]
      setRoles(availableRoles)
      setRole((current) => availableRoles.includes(current) ? current : availableRoles[0])
    }).catch(() => {
      if (mounted) setRoles(['Admin'])
    }).finally(() => {
      if (mounted) setRolesLoading(false)
    })
    return () => { mounted = false }
  }, [])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!fullName.trim() || !email.trim() || !password || !role) return setNotice({ type: 'error', text: 'يرجى ملء جميع الحقول المطلوبة.' })
    if (password.length < 6) return setNotice({ type: 'error', text: 'يجب أن تتكون كلمة المرور من ٦ أحرف على الأقل.' })
    setLoading(true)
    setNotice(null)
    try {
      // Adding a user to *this* company, not minting a new company+owner.
      const rolePage = await rolesApi.list({ pageSize: 100 })
      const matched = rolePage.items.find((item) => item.name === role)
      await usersApi.create({
        fullName: fullName.trim(),
        email: email.trim(),
        password,
        phoneNumber: phoneNumber.trim() || null,
        roleIds: matched ? [matched.id] : [],
      })
      setFullName(''); setEmail(''); setPassword(''); setPhoneNumber('')
      setNotice({ type: 'success', text: `تم تسجيل الحساب بدور ${role} بنجاح.` })
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'تعذر تسجيل الحساب.' })
    } finally {
      setLoading(false)
    }
  }

  return <section className="ss-module animate-fade-in"><div className="ss-module-heading"><div className="ss-module-icon"><UserPlusIcon /></div><div><p className="ss-eyebrow">إدارة الوصول</p><h2>تسجيل حساب جديد</h2><p>أنشئ مستخدماً جديداً بدور موجود فعلياً في النظام.</p></div></div><StatusBanner notice={notice} /><form className="ss-account-form ss-register-form" onSubmit={submit}><div className="ss-form-field"><label htmlFor="register-name">الاسم الكامل</label><input id="register-name" className="ss-input" value={fullName} onChange={(event) => setFullName(event.target.value)} disabled={loading} /></div><div className="ss-form-field"><label htmlFor="register-email">البريد الإلكتروني</label><input id="register-email" className="ss-input" type="email" value={email} onChange={(event) => setEmail(event.target.value)} disabled={loading} /></div><div className="ss-form-field"><label htmlFor="register-password">كلمة المرور</label><input id="register-password" className="ss-input" type="password" value={password} onChange={(event) => setPassword(event.target.value)} disabled={loading} /></div><div className="ss-form-field"><label htmlFor="register-phone">رقم الهاتف <span>اختياري</span></label><input id="register-phone" className="ss-input" value={phoneNumber} onChange={(event) => setPhoneNumber(event.target.value)} disabled={loading} /></div><div className="ss-form-field"><label htmlFor="register-role">الدور</label><select id="register-role" className="ss-input" value={role} onChange={(event) => setRole(event.target.value)} disabled={loading || rolesLoading}>{roles.map((roleName) => <option value={roleName} key={roleName}>{roleName}</option>)}</select><small>{rolesLoading ? 'جاري تحميل الأدوار...' : 'تظهر هنا مجموعات الصلاحيات المنشأة في الخلفية.'}</small></div><div className="ss-form-actions"><Button type="submit" disabled={loading || rolesLoading}>{loading ? 'جاري التسجيل...' : 'تسجيل الحساب'}</Button></div></form></section>
}

function AdminResetTab() {
  const [users, setUsers] = useState<CompanyUser[]>([])
  const [usersLoading, setUsersLoading] = useState(true)
  const [selectedUserId, setSelectedUserId] = useState<string>('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)

  useEffect(() => {
    let mounted = true
    setUsersLoading(true)
    void usersApi.list({ pageSize: 200 }).then((page) => {
      if (!mounted) return
      setUsers(page.items)
      if (page.items.length > 0) setSelectedUserId(page.items[0].id)
    }).catch(() => {
      if (mounted) setNotice({ type: 'error', text: 'تعذر تحميل قائمة المستخدمين.' })
    }).finally(() => {
      if (mounted) setUsersLoading(false)
    })
    return () => { mounted = false }
  }, [])

  const selectedUser = users.find(u => u.id === selectedUserId)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!selectedUser || password.length < 6) return setNotice({ type: 'error', text: 'اختر مستخدم وأدخل كلمة مرور جديدة من ٦ أحرف على الأقل.' })
    setLoading(true)
    setNotice(null)
    try {
      await usersApi.resetPassword(selectedUser.id, password)
      setPassword('')
      setNotice({ type: 'success', text: `تم تحديث كلمة مرور المستخدم ${selectedUser.fullName} بنجاح.` })
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'تعذر تحديث كلمة المرور.' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="ss-module animate-fade-in">
      <div className="ss-module-heading"><div className="ss-module-icon"><KeyIcon /></div><div><p className="ss-eyebrow">صلاحية المدير</p><h2>إعادة تعيين كلمة مرور</h2><p>غيّر كلمة مرور مستخدم مسجل دون الحاجة إلى كلمته الحالية.</p></div></div>
      <StatusBanner notice={notice} />
      <form className="ss-account-form" onSubmit={submit}>
        <div className="ss-form-field">
          <label>المستخدم</label>
          <Select
            value={selectedUserId}
            onChange={(v) => setSelectedUserId(v as string)}
            options={users.map(u => ({ value: u.id, label: `${u.fullName} (${u.email})` }))}
            loading={usersLoading}
            placeholder={usersLoading ? 'جاري التحميل...' : 'اختر مستخدم'}
          />
          <small>{usersLoading ? 'جاري تحميل المستخدمين...' : `${users.length} مستخدم مسجل`}</small>
        </div>
        <div className="ss-form-field">
          <label htmlFor="reset-password">كلمة المرور الجديدة</label>
          <input id="reset-password" className="ss-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={loading} />
        </div>
        <div className="ss-form-actions">
          <Button type="submit" disabled={loading || usersLoading || !selectedUser}>{loading ? 'جاري التحديث...' : 'تحديث كلمة المرور'}</Button>
        </div>
      </form>
    </section>
  )
}

function RevokeTokenTab({ navigate }: { navigate: (path: string) => void }) {
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [sessions, setSessions] = useState<ActiveSession[]>([])
  const [scope, setScope] = useState<SessionList['scope']>('own')
  const [busyId, setBusyId] = useState<string | null>(null)

  // Load once on mount. The list is a snapshot of "who is signed in right now",
  // and every action below refreshes it, so a poll would add traffic without
  // adding truth.
  //
  // `keepNotice` exists because this is called after a successful revoke: it
  // must refresh the table WITHOUT clearing the "تم إنهاء الجلسة" message the
  // caller just set. Clearing it here made a successful action look like it did
  // nothing — the row vanished and no confirmation appeared.
  const load = useCallback(async ({ keepNotice = false }: { keepNotice?: boolean } = {}) => {
    setLoading(true)
    try {
      const result = await sessionsApi.list()
      setSessions(result.sessions)
      setScope(result.scope)
      if (!keepNotice) setNotice(null)
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'تعذر تحميل الجلسات.' })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const endSession = async (session: ActiveSession) => {
    const message = session.isCurrent
      ? 'هذه جلستك الحالية وسيتم تسجيل خروجك. هل تريد المتابعة؟'
      : `سيتم إنهاء جلسة ${session.user.fullName}. هل تريد المتابعة؟`
    if (!window.confirm(message)) return

    setBusyId(session.id)
    setNotice(null)
    try {
      const result = await sessionsApi.revoke(session.id)
      if (result.wasCurrent) {
        // Ending your own session invalidates the pair, so there is nothing to
        // re-render — leave the same way the logout button always has.
        setNotice({ type: 'success', text: 'تم إنهاء الجلسة. جارٍ تحويلك لتسجيل الدخول...' })
        window.setTimeout(() => navigate('/login'), 900)
        return
      }
      setNotice({
        type: 'success',
        text: result.alreadyRevoked ? 'الجلسة منتهية بالفعل.' : 'تم إنهاء الجلسة.',
      })
      // keepNotice: the message above must survive the refresh.
      await load({ keepNotice: true })
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'تعذر إنهاء الجلسة.' })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="ss-module animate-fade-in">
      <div className="ss-module-heading">
        <div className="ss-module-icon"><ShieldIcon /></div>
        <div>
          <p className="ss-eyebrow">أمان الجلسة</p>
          <h2>{scope === 'company' ? 'الجلسات النشطة' : 'جلساتك النشطة'}</h2>
          <p>
            {scope === 'company'
              ? 'كل جلسة مسجّلة الدخول حالياً في الشركة. إنهاء أي جلسة يُبطل رمز التحديث الخاص بها على الخادم فوراً.'
              : 'الأجهزة المسجّلة الدخول بحسابك. إنهاء أي جلسة يُبطل رمز التحديث الخاص بها على الخادم فوراً.'}
          </p>
        </div>
      </div>
      <StatusBanner notice={notice} />

      <div className="ss-data-surface">
        {loading ? (
          <div className="ss-loading-list">
            {[0, 1, 2].map((i) => <div className="ss-skeleton-row" key={i} />)}
          </div>
        ) : sessions.length === 0 ? (
          <div className="ss-empty-state">
            <div className="ss-empty-mark">⌁</div>
            <p>لا توجد جلسات نشطة.</p>
          </div>
        ) : (
          <div className="ss-table-scroll">
            <table className="ss-table">
              <thead>
                <tr>
                  {scope === 'company' && <th>المستخدم</th>}
                  <th>الجهاز</th>
                  <th>عنوان IP</th>
                  <th>بدأت</th>
                  <th>تنتهي</th>
                  <th aria-label="إجراءات" />
                </tr>
              </thead>
              <tbody>
                {sessions.map((session) => (
                  <tr key={session.id}>
                    {scope === 'company' && (
                      <td>
                        <span className="ss-item-name">{session.user.fullName}</span>
                        <small className="ss-cell-sub">{session.user.email}</small>
                      </td>
                    )}
                    <td>
                      {describeDevice(session.userAgent)}
                      {session.isCurrent && <span className="ss-related-badge">هذه الجلسة</span>}
                    </td>
                    <td>{session.ipAddress ?? '—'}</td>
                    <td>{formatMoment(session.createdAt)}</td>
                    <td>{formatMoment(session.expiresAt)}</td>
                    <td>
                      <div className="ss-row-actions">
                        <Button
                          variant="danger"
                          onClick={() => void endSession(session)}
                          disabled={busyId === session.id}
                        >
                          {busyId === session.id ? 'جاري الإنهاء...' : 'إنهاء'}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  )
}

function CompanyProfileShortcut({ navigate }: { navigate: (path: string) => void }) {
  return (
    <section className="ss-module animate-fade-in">
      <div className="ss-module-heading">
        <div className="ss-module-icon"><TagIcon /></div>
        <div>
          <p className="ss-eyebrow">هوية النشاط</p>
          <h2>بيانات الشركة</h2>
          <p>الاسم القانوني والسجل التجاري والعنوان — وهي بيانات تُطبع على الفواتير والمستندات.</p>
        </div>
      </div>
      <div className="ss-form-actions">
        <button type="button" className="ss-button ss-button-primary" onClick={() => navigate('/dashboard/company')}>
          فتح ملف الشركة
        </button>
      </div>
    </section>
  )
}

const settingsTabs: { id: Tab; label: string; hint: string; icon: ReactNode }[] = [
  { id: 'set-company', label: 'بيانات الشركة', hint: 'هوية النشاط', icon: <TagIcon /> },
  { id: 'set-accounting', label: 'إعدادات المحاسبة', hint: 'الافتراضيات المالية', icon: <CreditCardIcon /> },
  { id: 'set-inventory', label: 'إعدادات المخزون', hint: 'سياسة الخصم', icon: <LayersIcon /> },
  { id: 'set-purchases', label: 'إعدادات المشتريات', hint: 'شروط الموردين', icon: <HomeIcon /> },
  { id: 'set-sales', label: 'إعدادات المبيعات', hint: 'دورة الطلب', icon: <GlobeIcon /> },
  { id: 'set-shipping', label: 'إعدادات الشحن', hint: 'أسعار التوصيل', icon: <TruckIcon /> },
  { id: 'governorates', label: 'المحافظات', hint: 'مناطق الشحن', icon: <MapPinIcon /> },
  { id: 'cities', label: 'المدن', hint: 'التقسيم الجغرافي', icon: <MapIcon /> },
  { id: 'order-sources', label: 'مصادر الطلبات', hint: 'قنوات البيع', icon: <GlobeIcon /> },
  { id: 'payment-methods', label: 'طرق الدفع', hint: 'التحصيل', icon: <CreditCardIcon /> },
  { id: 'shipping-companies', label: 'شركات الشحن', hint: 'التوصيل', icon: <TruckIcon /> },
]

function LockedSettingsState() {
  return <section className="ss-module ss-locked-module animate-fade-in"><div className="ss-module-heading"><div className="ss-module-icon"><ShieldIcon /></div><div><p className="ss-eyebrow">صلاحية مطلوبة</p><h2>إعدادات النظام مقفلة</h2><p>يحتاج هذا القسم إلى صلاحية إدارة إعدادات النظام. اطلب من المدير إضافتها إلى دورك.</p></div></div><div className="ss-lock-card"><div className="ss-lock-mark">⌁</div><div><strong>Permissions.ManageSettings</strong><span>لا توجد صلاحية كافية لقراءة أو تعديل البيانات المرجعية.</span></div></div></section>
}

export default function SystemSettings({ navigate }: SystemSettingsProps) {
  // Effective permissions, resolved by the server from the company's roles plus
  // ownership. Previously this read role *names* out of localStorage, which went
  // stale the moment an admin revoked a role, silently granted nothing for a
  // custom role, and made an authorisation decision from client-side state.
  const { hasPermission, isCompanyOwner, isReady } = useCurrentUser()

  // Until the principal arrives we know nothing, so nothing privileged is
  // offered. The server enforces this regardless; this only avoids rendering
  // controls that are about to disappear.
  const canManageSettings = isReady && (isCompanyOwner || hasPermission('Permissions.ManageSettings'))
  const hasViewBrands = isReady && (isCompanyOwner || hasPermission('Permissions.ViewBrands'))
  const hasViewCategories = isReady && (isCompanyOwner || hasPermission('Permissions.ViewCategories'))
  const hasViewWarehouses = isReady && (isCompanyOwner || hasPermission('Permissions.ViewWarehouses'))
  const isAdmin = canManageSettings

  const tabs = useMemo(() => {
    const base: { id: Tab; label: string; hint: string; icon: ReactNode }[] = [
      { id: 'account', label: 'الحساب', hint: 'كلمة المرور', icon: <UserIcon /> },
    ]
    if (isAdmin) {
      base.push({ id: 'register', label: 'حساب جديد', hint: 'إدارة المستخدمين', icon: <UserPlusIcon /> })
      base.push({ id: 'admin-reset', label: 'إعادة تعيين', hint: 'إدارة الوصول', icon: <KeyIcon /> })
    }
    if (canManageSettings) {
      base.push(...settingsTabs)
    }
    if (hasViewBrands) {
      base.push({ id: 'brands', label: 'الماركات', hint: 'إدارة الماركات', icon: <TagIcon /> })
    }
    if (hasViewCategories) {
      base.push({ id: 'categories', label: 'الأقسام', hint: 'تصنيف المنتجات', icon: <LayersIcon /> })
    }
    if (hasViewWarehouses) {
      base.push({ id: 'warehouses', label: 'المستودعات', hint: 'إدارة المخازن', icon: <HomeIcon /> })
    }
    base.push({ id: 'revoke-token', label: 'إنهاء الجلسة', hint: 'أمان فوري', icon: <ShieldIcon /> })
    return base
  }, [isAdmin, canManageSettings, hasViewBrands, hasViewCategories, hasViewWarehouses])

  // The landing tab depends on permissions, which are not known on the first
  // render. It is applied in an effect rather than in the initialiser so that
  // the hooks below are called unconditionally — a conditional hook call is a
  // bug React cannot recover from.
  const [activeTab, setActiveTab] = useState<Tab>('account')
  const defaultApplied = useRef(false)

  useEffect(() => {
    if (!isReady || defaultApplied.current) return
    defaultApplied.current = true
    if (canManageSettings) setActiveTab('governorates')
    else if (hasViewBrands) setActiveTab('brands')
    else if (hasViewCategories) setActiveTab('categories')
    else if (hasViewWarehouses) setActiveTab('warehouses')
  }, [isReady, canManageSettings, hasViewBrands, hasViewCategories, hasViewWarehouses])

  useEffect(() => {
    if (!tabs.some((tab) => tab.id === activeTab)) {
      if (tabs.length > 0) setActiveTab(tabs[0].id)
    }
  }, [activeTab, tabs])

  const renderPanel = () => {
    switch (activeTab) {
      case 'account': return <AccountTab />
      case 'register': return <RegisterTab />
      case 'admin-reset': return <AdminResetTab />
      case 'set-company': return <CompanyProfileShortcut navigate={navigate} />
      // Typed forms bound to CompanySettings columns. The section definitions
      // live beside the form; an unknown id renders nothing rather than
      // guessing at a scope.
      case 'set-accounting': return <SettingsSection section={findSection('accounting')} />
      case 'set-inventory': return <SettingsSection section={findSection('inventory')} />
      case 'set-purchases': return <SettingsSection section={findSection('purchases')} />
      case 'set-sales': return <SettingsSection section={findSection('sales')} />
      case 'set-shipping': return <SettingsSection section={findSection('shipping')} />
      case 'governorates': return <GovernoratesManagement navigate={navigate} embedded />
      case 'cities': return <CitiesManagement navigate={navigate} embedded />
      case 'order-sources': return <OrderSourcesManagement navigate={navigate} embedded />
      case 'payment-methods': return <PaymentMethodsManagement navigate={navigate} embedded />
      case 'shipping-companies': return <ShippingCompaniesManagement navigate={navigate} embedded />
      case 'brands': return hasViewBrands ? <BrandsManagement navigate={navigate} embedded /> : <LockedSettingsState />
      case 'categories': return hasViewCategories ? <CategoriesManagement navigate={navigate} embedded /> : <LockedSettingsState />
      case 'warehouses': return hasViewWarehouses ? <WarehousesManagement navigate={navigate} embedded /> : <LockedSettingsState />
      case 'revoke-token': return <RevokeTokenTab navigate={navigate} />
      default: {
        return <AccountTab />
      }
    }
  }

  // Permission-gated shell. Placed after every hook: returning earlier would
  // make the hook calls above conditional, which React forbids.
  if (!isReady) {
    return (
      <DashboardLayout navigate={navigate}>
        <div className="ss-container animate-fade-in">
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>جاري تحميل صلاحياتك...</p>
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout navigate={navigate}>
      <div className="ss-container animate-fade-in">
        <header className="ss-page-header">
          <div>
            <p className="ss-page-kicker">مساحة الإدارة والتحكم</p>
            <h1 className="ss-page-title">إعدادات النظام</h1>
            <p className="ss-page-sub">إدارة البيانات المرجعية التي تغذي نماذج الطلبات وعناوين الشحن.</p>
          </div>
        </header>

        <div className="ss-body">
          <aside className="ss-nav-card">
            <div className="ss-nav-label">أقسام الإعدادات</div>
            <nav className="ss-nav" aria-label="أقسام إعدادات النظام">
              {tabs.map((tab) => <button key={tab.id} className={`ss-nav-btn ${activeTab === tab.id ? 'ss-nav-btn-active' : ''}`} onClick={() => setActiveTab(tab.id)}><span className="ss-nav-icon">{tab.icon}</span><span className="ss-nav-text"><strong>{tab.label}</strong><small>{tab.hint}</small></span><span className="ss-nav-arrow">←</span></button>)}
            </nav>
            <div className="ss-nav-footer"><div className="ss-nav-footer-icon"><InfoIcon /></div><p>تُحفظ التغييرات مباشرة في النظام.</p></div>
          </aside>
          <main className="ss-content">{renderPanel()}</main>
        </div>
      </div>
    </DashboardLayout>
  )
}
