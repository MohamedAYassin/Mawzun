import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import DashboardLayout from '../../components/DashboardLayout/DashboardLayout'
import { systemApi, settingsApi, type Store, type StorePlatform } from '../../lib/api'
import { ModuleHeading, ModuleActions, StatusBanner, ListToolbar, LoadingState, EmptyState, EditorHeader, EditorActions, RowActions, ActiveBadge, GlobeIcon, Button, type Notice } from '../shared/ManagementUi'
import '../SystemSettings/SystemSettings.css'

interface StoresManagementProps {
  navigate: (path: string) => void
}

const PLATFORM_LABELS: Record<string, string> = {
  SHOPIFY: 'Shopify',
  CUSTOM: 'مخصص'
}

export { PLATFORM_LABELS }

function StoresTab() {
  const [items, setItems] = useState<Store[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Store | null>(null)
  const [name, setName] = useState('')
  const [platform, setPlatform] = useState<StorePlatform>('CUSTOM')
  const [storeUrl, setStoreUrl] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [lastLoaded, setLastLoaded] = useState<Date | null>(null)
  const [backfilling, setBackfilling] = useState<string | null>(null)
  const [shopifyEnabled, setShopifyEnabled] = useState(true)

  const load = useCallback(async (showLoader = true) => {
    if (showLoader) setLoading(true)
    try {
      const page = await systemApi.listStores({ pageSize: 200 })
      setItems(page.items)
      setLastLoaded(new Date())
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'تعذر تحميل المتاجر.' })
    } finally { setLoading(false) }
  }, [])

  // Company-level Shopify switch (settingsApi is loaded separately so a
  // settings failure never blocks the stores list).
  useEffect(() => {
    let cancelled = false
    settingsApi.get().then((s) => {
      if (!cancelled) setShopifyEnabled(s.shopifyEnabled)
    }).catch(() => { /* default true on failure */ })
    return () => { cancelled = true }
  }, [])

  useEffect(() => { void load() }, [load])

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter((item) => item.name.toLowerCase().includes(q) || item.storeUrl.toLowerCase().includes(q))
  }, [items, query])

  const startAdd = () => { setEditing(null); setName(''); setPlatform('CUSTOM'); setStoreUrl(''); setIsActive(true); setFormOpen(true); setNotice(null) }
  const startEdit = (item: Store) => { setEditing(item); setName(item.name); setPlatform(item.platform); setStoreUrl(item.storeUrl); setIsActive(item.isActive); setFormOpen(true); setNotice(null) }
  const closeForm = () => { setFormOpen(false); setEditing(null); setName(''); setPlatform('CUSTOM'); setStoreUrl(''); setIsActive(true) }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim()) { setNotice({ type: 'error', text: 'يرجى إدخال اسم المتجر.' }); return }
    setSaving(true); setNotice(null)
    try {
      if (editing) {
        await systemApi.updateStore(editing.id, { name: name.trim(), platform, storeUrl: storeUrl.trim(), isActive })
        setNotice({ type: 'success', text: 'تم تحديث المتجر بنجاح.' })
      } else {
        await systemApi.createStore({ name: name.trim(), platform, storeUrl: storeUrl.trim(), isActive })
        setNotice({ type: 'success', text: 'تمت إضافة المتجر بنجاح.' })
      }
      closeForm(); await load(false)
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'تعذر حفظ البيانات.' })
    } finally { setSaving(false) }
  }

  const remove = async (item: Store) => {
    if (!window.confirm(`هل أنت متأكد من حذف المتجر «${item.name}»؟`)) return
    setSaving(true); setNotice(null)
    try {
      await systemApi.deleteStore(item.id)
      setNotice({ type: 'success', text: 'تم حذف المتجر بنجاح.' })
      if (editing?.id === item.id) closeForm()
      await load(false)
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'تعذر حذف المتجر.' })
    } finally { setSaving(false) }
  }

  // Historical order backfill: pulls all Shopify orders since the chosen date
  // (bounded per call — press again to continue if not done).
  const backfill = async (item: Store) => {
    const since = window.prompt(
      `استيراد الطلبات السابقة من «${item.name}».\nأدخل التاريخ (اتركه فارغاً لآخر 90 يوماً):`,
      ''
    )
    if (since === null) return
    const sinceIso = since.trim() ? new Date(since.trim()).toISOString() : undefined
    if (since.trim() && Number.isNaN(new Date(since.trim()).getTime())) {
      setNotice({ type: 'error', text: 'التاريخ غير صالح.' }); return
    }
    setBackfilling(item.id); setNotice(null)
    try {
      const r = await systemApi.backfillStore(item.id, sinceIso)
      const parts = [`تم جلب ${r.fetched} طلب`, `جديد: ${r.created}`, `مكرر: ${r.duplicates}`]
      if (r.unmappedSkus > 0) parts.push(`أصناف غير مطابقة: ${r.unmappedSkus} (راجع أخطاء المزامنة)`)
      if (!r.done) parts.push('لم تكتمل — اضغط مرة أخرى للمتابعة')
      setNotice({ type: r.done ? 'success' : 'error', text: parts.join(' — ') + '.' })
      await load(false)
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'تعذر استيراد الطلبات.' })
    } finally { setBackfilling(null) }
  }

  const fmtSync = (iso: string | null) => {
    if (!iso) return 'لم تتم المزامنة بعد'
    const d = new Date(iso)
    return d.toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' })
  }

  return { items, filteredItems, query, setQuery, loading, saving, formOpen, editing, name, setName, platform, setPlatform, storeUrl, setStoreUrl, isActive, setIsActive, notice, lastLoaded, load, startAdd, startEdit, closeForm, submit, remove, backfill, backfilling, fmtSync, shopifyEnabled }
}

function StoresView() {
  const t = StoresTab()
  return (
    <section className="ss-module animate-fade-in">
      <ModuleHeading icon={<GlobeIcon />} eyebrow="التكاملات" title="المتاجر المربوطة (Stores)" subtitle="متاجر البيع الإلكتروني المتصلة بالنظام لمزامنة المنتجات والطلبات." />
      {!t.shopifyEnabled && (
        <div className="ss-status ss-status-info" role="status" style={{ marginBottom: '1rem' }}>
          <strong>مزامنة Shopify معطّلة على هذا الحساب.</strong>{' '}
          لاستخدام Shopify — مزامنة الطلبات والمنتجات والمخزون — استضف نسختك الخاصة من Mawzun
          (النسخة الذاتية الاستضافة تستقبل إشعارات Shopify مباشرة). راجع{' '}
          <a href="https://docs.mawzun.org" target="_blank" rel="noreferrer" style={{ textDecoration: 'underline' }}>docs.mawzun.org</a>{' '}
          لخطوات التشغيل. المتاجر المخصصة تعمل كالمعتاد.
        </div>
      )}
      <ModuleActions
        count={t.items.length}
        countLabel="متجر"
        onRefresh={() => void t.load()}
        loading={t.loading}
        saving={t.saving}
        onAdd={t.startAdd}
        addLabel="إضافة متجر"
      />
      <StatusBanner notice={t.notice} />
      <ListToolbar query={t.query} setQuery={t.setQuery} placeholder="ابحث باسم المتجر أو الرابط..." lastLoaded={t.lastLoaded} />
      {t.formOpen && (
        <form className="ss-multi-editor" onSubmit={t.submit}>
          <EditorHeader editing={!!t.editing} singular="المتجر" />
          <div className="ss-editor-field">
            <label htmlFor="store-name">اسم المتجر</label>
            <input id="store-name" className="ss-input" value={t.name} onChange={(event) => t.setName(event.target.value)} placeholder="مثال: متجر الموزون الرسمي" autoFocus disabled={t.saving} />
          </div>
          <div className="ss-editor-field">
            <label htmlFor="store-platform">المنصة</label>
            <select
              id="store-platform"
              className="ss-input"
              value={t.platform}
              onChange={(event) => t.setPlatform(event.target.value as StorePlatform)}
              disabled={t.saving}
            >
              <option value="CUSTOM">مخصص</option>
              {!t.shopifyEnabled ? (
                <option value="SHOPIFY" disabled>Shopify — معطّل (استضف نسختك الخاصة)</option>
              ) : (
                <option value="SHOPIFY">Shopify</option>
              )}
            </select>
            {!t.shopifyEnabled && (
              <small style={{ display: 'block', marginTop: '0.25rem', fontSize: '0.78rem', opacity: 0.8 }}>
                Shopify معطّل على هذا الحساب — استضف نسخة خاصة من Mawzun لتفعيله (docs.mawzun.org).
              </small>
            )}
          </div>
          <div className="ss-editor-field">
            <label htmlFor="store-url">رابط المتجر</label>
            <input id="store-url" className="ss-input" value={t.storeUrl} onChange={(event) => t.setStoreUrl(event.target.value)} placeholder="https://..." dir="ltr" disabled={t.saving} />
          </div>
          <div className="ss-editor-field ss-multi-editor-full">
            <label className="ss-checkbox-label">
              <input type="checkbox" checked={t.isActive} onChange={(e) => t.setIsActive(e.target.checked)} disabled={t.saving} />
              <span>متجر نشط</span>
            </label>
          </div>
          <EditorActions closeForm={t.closeForm} saving={t.saving} editing={!!t.editing} />
        </form>
      )}
      <div className="ss-data-surface">
        {t.loading ? <LoadingState /> : t.filteredItems.length === 0 ? <EmptyState hasSearch={Boolean(t.query.trim())} /> : (
          <div className="ss-table-scroll">
            <table className="ss-table">
              <thead><tr><th>#</th><th>الاسم</th><th>المنصة</th><th>الرابط</th><th>آخر مزامنة</th><th>الحالة</th><th className="ss-actions-column">الإجراءات</th></tr></thead>
              <tbody>
                {t.filteredItems.map((item, index) => (
                  <tr key={item.id}>
                    <td><span className="ss-row-number">{index + 1}</span></td>
                    <td><span className="ss-item-name">{item.name}</span></td>
                    <td><span className="ss-related-badge">{PLATFORM_LABELS[item.platform] || item.platform}</span></td>
                    <td><a href={item.storeUrl || '#'} target="_blank" rel="noreferrer" dir="ltr" style={{ color: 'var(--color-warning)' }}>{item.storeUrl || '—'}</a></td>
                    <td><span style={{ fontSize: '0.85rem', whiteSpace: 'nowrap' }}>{t.fmtSync(item.lastSyncedAt)}</span>{item._count.syncErrors > 0 && <span className="ss-related-badge" style={{ marginRight: '0.4rem', color: 'var(--color-danger)' }}>{item._count.syncErrors} خطأ</span>}</td>
                    <td><ActiveBadge isActive={item.isActive} /></td>
                    <RowActions onEdit={() => t.startEdit(item)} onDelete={() => void t.remove(item)} saving={t.saving} name={item.name} />
                    {item.platform === 'SHOPIFY' && t.shopifyEnabled && (
                      <td>
                        <Button variant="secondary" disabled={t.backfilling === item.id || t.saving} onClick={() => void t.backfill(item)}>
                          {t.backfilling === item.id ? 'جارٍ الاستيراد...' : 'استيراد الطلبات السابقة'}
                        </Button>
                      </td>
                    )}
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

export default function StoresManagement({ navigate }: StoresManagementProps) {
  return (
    <DashboardLayout navigate={navigate}>
      <div className="view-container">
        <StoresView />
      </div>
    </DashboardLayout>
  )
}
