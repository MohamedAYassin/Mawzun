import { useCallback, useEffect, useState, type FormEvent } from 'react'
import DashboardLayout from '../../components/DashboardLayout/DashboardLayout'
import { systemApi, type ApiKey } from '../../lib/api'
import { ModuleHeading, ModuleActions, StatusBanner, LoadingState, EmptyState, EditorHeader, EditorActions, Button, KeyIcon, type Notice } from '../shared/ManagementUi'
import '../SystemSettings/SystemSettings.css'

interface ApiKeysManagementProps {
  navigate: (path: string) => void
}

function ApiKeysTab() {
  const [items, setItems] = useState<ApiKey[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<ApiKey | null>(null)
  const [name, setName] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [rateLimitMax, setRateLimitMax] = useState('')
  const [rateLimitWindowMs, setRateLimitWindowMs] = useState('')
  const [createdKey, setCreatedKey] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [lastLoaded, setLastLoaded] = useState<Date | null>(null)

  const load = useCallback(async (showLoader = true) => {
    if (showLoader) setLoading(true)
    try {
      const page = await systemApi.listApiKeys({ pageSize: 100 })
      setItems(page.items)
      setLastLoaded(new Date())
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'تعذر تحميل المفاتيح.' })
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load])

  const startAdd = () => { setEditing(null); setFormOpen(true); setName(''); setExpiresAt(''); setRateLimitMax(''); setRateLimitWindowMs(''); setCreatedKey(null); setNotice(null) }
  const startEdit = (item: ApiKey) => {
    setEditing(item)
    setFormOpen(true)
    setName(item.name)
    // The date input wants yyyy-mm-dd; the API sends a full ISO timestamp.
    setExpiresAt(item.expiresAt ? item.expiresAt.slice(0, 10) : '')
    // Empty = worker default (600/min). Shown blank, sent as null.
    setRateLimitMax(item.rateLimitMax != null ? String(item.rateLimitMax) : '')
    setRateLimitWindowMs(item.rateLimitWindowMs != null ? String(item.rateLimitWindowMs) : '')
    setCreatedKey(null)
    setNotice(null)
  }
  const closeForm = () => { setFormOpen(false); setEditing(null); setName(''); setExpiresAt(''); setRateLimitMax(''); setRateLimitWindowMs(''); setCreatedKey(null) }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim()) { setNotice({ type: 'error', text: 'يرجى إدخال اسم المفتاح.' }); return }
    const max = rateLimitMax.trim() === '' ? null : Math.max(1, Math.floor(Number(rateLimitMax)))
    const windowMs = rateLimitWindowMs.trim() === '' ? null : Math.max(1000, Math.floor(Number(rateLimitWindowMs)))
    if ((rateLimitMax.trim() !== '' && (!Number.isFinite(max) || (max as number) <= 0)) || (rateLimitWindowMs.trim() !== '' && (!Number.isFinite(windowMs) || (windowMs as number) < 1000))) {
      setNotice({ type: 'error', text: 'حد الطلبات رقم موجب، والنافذة 1000ms على الأقل — أو اتركهما فارغين للافتراضي.' })
      return
    }
    setSaving(true); setNotice(null)
    try {
      if (editing) {
        await systemApi.updateApiKey(editing.id, { name: name.trim(), expiresAt: expiresAt || null, rateLimitMax: max, rateLimitWindowMs: windowMs })
        setNotice({ type: 'success', text: 'تم تحديث المفتاح بنجاح.' })
      } else {
        // The create response carries `token` — the one time the full secret
        // exists. Show it now with the copy button; afterwards only the
        // prefix identifies the key.
        const created = await systemApi.createApiKey({ name: name.trim(), expiresAt: expiresAt || null, rateLimitMax: max, rateLimitWindowMs: windowMs })
        setCreatedKey(created.token ?? created.keyPrefix)
        setNotice({ type: 'success', text: 'تم إنشاء المفتاح بنجاح. انسخ السر الكامل الآن — لن يظهر مرة أخرى.' })
      }
      await load(false)
      if (editing) closeForm()
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'تعذر حفظ المفتاح.' })
    } finally { setSaving(false) }
  }

  const toggle = async (item: ApiKey) => {
    setSaving(true); setNotice(null)
    try {
      // The backend has no re-activate path; a revoked key stays revoked, so
      // the only transition offered is revoke.
      await systemApi.revokeApiKey(item.id)
      setNotice({ type: 'success', text: 'تم إبطال المفتاح.' })
      await load(false)
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'تعذر تحديث المفتاح.' })
    } finally { setSaving(false) }
  }

  const remove = async (item: ApiKey) => {
    if (!window.confirm(`هل أنت متأكد من حذف المفتاح «${item.name}»؟ لا يمكن التراجع عن هذه الخطوة.`)) return
    setSaving(true); setNotice(null)
    try {
      await systemApi.deleteApiKey(item.id)
      setNotice({ type: 'success', text: 'تم حذف المفتاح بنجاح.' })
      await load(false)
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'تعذر حذف المفتاح.' })
    } finally { setSaving(false) }
  }

  const copyKey = async (key: string) => {
    try {
      await navigator.clipboard.writeText(key)
      setNotice({ type: 'info', text: 'تم نسخ المفتاح إلى الحافظة.' })
    } catch {
      setNotice({ type: 'error', text: 'تعذر النسخ إلى الحافظة، انسخه يدوياً.' })
    }
  }

  return { items, loading, saving, formOpen, editing, name, setName, expiresAt, setExpiresAt, rateLimitMax, setRateLimitMax, rateLimitWindowMs, setRateLimitWindowMs, createdKey, notice, lastLoaded, load, startAdd, startEdit, closeForm, submit, toggle, remove, copyKey }
}

function ApiKeysView() {
  const t = ApiKeysTab()
  return (
    <section className="ss-module animate-fade-in">
      <ModuleHeading icon={<KeyIcon />} eyebrow="الإعدادات" title="المفاتيح البرمجية (API Keys)" subtitle="مفاتيح الوصول البرمجي لواجهات النظام للتكاملات الخارجية." />
      <ModuleActions count={t.items.length} countLabel="مفتاح" onRefresh={() => void t.load()} loading={t.loading} saving={t.saving} onAdd={t.startAdd} addLabel="إنشاء مفتاح" />
      <StatusBanner notice={t.notice} />
      {t.formOpen && (
        <form className="ss-multi-editor" onSubmit={t.submit}>
          <EditorHeader editing={!!t.editing} singular="مفتاح" />
          <div className="ss-editor-field">
            <label htmlFor="apikey-name">اسم المفتاح</label>
            <input id="apikey-name" className="ss-input" value={t.name} onChange={(event) => t.setName(event.target.value)} placeholder="مثال: تكامل المتجر الإلكتروني" autoFocus disabled={t.saving} />
          </div>
          <div className="ss-editor-field">
            <label htmlFor="apikey-expiry">تنتهي في (اختياري)</label>
            <input id="apikey-expiry" className="ss-input" type="date" value={t.expiresAt} onChange={(event) => t.setExpiresAt(event.target.value)} disabled={t.saving} style={{ direction: 'ltr' }} />
          </div>
          <div className="ss-editor-field">
            <label htmlFor="apikey-ratelimit">حد الطلبات (اختياري، الافتراضي 600)</label>
            <input id="apikey-ratelimit" className="ss-input" type="number" min={1} max={100000} value={t.rateLimitMax} onChange={(event) => t.setRateLimitMax(event.target.value)} placeholder="فارغ = افتراضي النظام" disabled={t.saving} style={{ direction: 'ltr' }} />
          </div>
          <div className="ss-editor-field">
            <label htmlFor="apikey-ratelimit-window">نافذة الحد بالمللي ثانية (اختياري، الافتراضي 60000)</label>
            <input id="apikey-ratelimit-window" className="ss-input" type="number" min={1000} max={3600000} step={1000} value={t.rateLimitWindowMs} onChange={(event) => t.setRateLimitWindowMs(event.target.value)} placeholder="فارغ = افتراضي النظام" disabled={t.saving} style={{ direction: 'ltr' }} />
          </div>
          {t.createdKey && (
            <div className="ss-editor-field ss-multi-editor-full">
              <label>المفتاح المُنشأ (انسخه الآن)</label>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <code className="ss-input" dir="ltr" style={{ flex: 1, overflowX: 'auto' }}>{t.createdKey}</code>
                <Button variant="secondary" onClick={() => void t.copyKey(t.createdKey as string)}>نسخ</Button>
              </div>
            </div>
          )}
          <EditorActions closeForm={t.closeForm} saving={t.saving} editing={!!t.editing} />
        </form>
      )}
      <div className="ss-data-surface">
        {t.loading ? <LoadingState /> : t.items.length === 0 ? <EmptyState hasSearch={false} /> : (
          <div className="ss-table-scroll">
            <table className="ss-table">
              <thead><tr><th>#</th><th>الاسم</th><th>المفتاح</th><th>الحالة</th><th>حد الطلبات</th><th>أُنشئ في</th><th>أُنشئ بواسطة</th><th>آخر استخدام</th><th>ينتهي في</th><th>أُلغي في</th><th className="ss-actions-column">الإجراءات</th></tr></thead>
              <tbody>
                {t.items.map((item, index) => (
                  <tr key={item.id}>
                    <td><span className="ss-row-number">{index + 1}</span></td>
                    <td><span className="ss-item-name">{item.name}</span></td>
                    <td><code dir="ltr" style={{ fontSize: '0.75rem' }}>{item.keyPrefix}••••••</code></td>
                    <td><span className="ss-related-badge" style={!item.isActive ? { background: 'var(--border-color)', color: 'var(--text-muted)' } : undefined}>{item.isActive ? 'نشط' : 'معطل'}</span></td>
                    <td><span dir="ltr">{item.rateLimitMax != null ? `${item.rateLimitMax}/${((item.rateLimitWindowMs ?? 60000) / 1000)}s` : 'افتراضي'}</span></td>
                    <td><span>{formatDateTime(item.createdAt)}</span></td>
                    <td><span>{item.createdBy?.fullName || '—'}</span></td>
                    <td><span>{formatDateTime(item.lastUsedAt)}</span></td>
                    <td><span>{formatDateTime(item.expiresAt)}</span></td>
                    <td><span>{formatDateTime(item.revokedAt)}</span></td>
                    <td className="ss-actions-column">
                      <div className="ss-row-actions">
                        <button className="ss-icon-button ss-icon-edit" onClick={() => t.startEdit(item)} disabled={t.saving} aria-label="تعديل" title="تعديل الاسم أو تاريخ الانتهاء أو حد الطلبات"><EditIconSmall /></button>
                        {item.isActive && <button className="ss-icon-button" onClick={() => void t.toggle(item)} disabled={t.saving} aria-label="إبطال" title="إبطال المفتاح"><KeyIcon size={16} /></button>}
                        <button className="ss-icon-button ss-icon-delete" onClick={() => void t.remove(item)} disabled={t.saving} aria-label="حذف" title="حذف"><TrashIconSmall /></button>
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

function TrashIconSmall() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v5M14 11v5M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>
}

function EditIconSmall() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m4 16-.7 4.7L8 20l10.7-10.7a2.1 2.1 0 0 0-3-3L5 17" /><path d="m14.5 7.5 2 2" /></svg>
}

/** Nullable timestamps render as an em dash rather than an empty cell. */
function formatDateTime(value: string | null): string {
  return value ? new Date(value).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' }) : '—'
}

export default function ApiKeysManagement({ navigate }: ApiKeysManagementProps) {
  return (
    <DashboardLayout navigate={navigate}>
      <div className="view-container">
        <ApiKeysView />
      </div>
    </DashboardLayout>
  )
}
