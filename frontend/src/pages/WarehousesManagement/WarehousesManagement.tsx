import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import DashboardLayout from '../../components/DashboardLayout/DashboardLayout'
import { inventoryApi, shippingApi, type Warehouse, type Country } from '../../lib/api'
import { useCurrentUser } from '../../hooks/useCurrentUser'
import { toArabicNumerals } from '../../utils/arabicNumerals'
import '../../styles/DashboardViews.css'
import '../AccountingOverview/AccountingOverview.css'
import '../SystemSettings/SystemSettings.css'

interface WarehousesManagementProps {
  navigate: (path: string) => void
  embedded?: boolean
}

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

const PlusIcon = () => <Icon><path d="M12 5v14M5 12h14" /></Icon>
const RefreshIcon = () => <Icon><path d="M20 11a8.1 8.1 0 0 0-14.8-4L3 10" /><path d="M3 5v5h5" /><path d="M4 13a8.1 8.1 0 0 0 14.8 4L21 14" /><path d="M21 19v-5h-5" /></Icon>
const EditIcon = () => <Icon size={16}><path d="m4 16-.7 4.7L8 20l10.7-10.7a2.1 2.1 0 0 0-3-3L5 17" /><path d="m14.5 7.5 2 2" /></Icon>
const TrashIcon = () => <Icon size={16}><path d="M4 7h16M10 11v5M14 11v5M6 7l1 13h10l1-13M9 7V4h6v3" /></Icon>

function StatusBanner({ notice }: { notice: Notice | null }) {
  if (!notice) return null
  return (
    <div style={{ padding: '0.5rem 1rem', fontSize: '0.8rem', background: notice.type === 'success' ? '#e6ffe6' : notice.type === 'error' ? 'var(--color-danger-soft)' : '#e6f3ff', borderBottom: '1px solid var(--border-color)' }}>
      {notice.text}
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

export default function WarehousesManagement({ navigate, embedded = false }: WarehousesManagementProps) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Warehouse | null>(null)
  // The backend returns warehouses as one bare array, so search, the active
  // filter and the pager are applied here rather than by the server.
  const [all, setAll] = useState<Warehouse[]>([])
  const [countries, setCountries] = useState<Country[]>([])

  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [address, setAddress] = useState('')
  const [countryCode, setCountryCode] = useState('')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [notes, setNotes] = useState('')
  const [isActive, setIsActive] = useState(true)

  const [notice, setNotice] = useState<Notice | null>(null)

  const [search, setSearch] = useState('')
  const [activeFilter, setActiveFilter] = useState<boolean | undefined>(undefined)

  const [page, setPage] = useState(1)
  const pageSize = 10

  const { hasPermission } = useCurrentUser()
  const hasCreate = hasPermission('Permissions.CreateWarehouse')
  const hasUpdate = hasPermission('Permissions.UpdateWarehouse')
  const hasDelete = hasPermission('Permissions.DeleteWarehouse')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [result, countryPage] = await Promise.all([
        inventoryApi.listWarehouses(),
        // Countries are global reference data and come back paginated. Only the
        // first page is needed to resolve codes to Arabic names; a failure here
        // must not take the warehouse list down with it, hence the fallback.
        shippingApi.listCountries({ isActive: true }).catch(() => null),
      ])
      setAll(result)
      setCountries(countryPage?.items ?? [])
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'تعذر تحميل المخازن.' })
    } finally {
      setLoading(false)
    }
  }, [])

  const filtered = all.filter((item) => {
    if (activeFilter !== undefined && item.isActive !== activeFilter) return false
    const q = search.trim().toLowerCase()
    if (!q) return true
    return [item.name, item.code, item.address, item.phoneNumber]
      .some((field) => (field || '').toLowerCase().includes(q))
  })
  const totalEntries = filtered.length
  const totalPages = Math.max(1, Math.ceil(totalEntries / pageSize))
  const entries = filtered.slice((page - 1) * pageSize, page * pageSize)

  useEffect(() => {
    void load()
  }, [load])

  const startAdd = () => {
    if (!hasCreate) return
    setEditing(null)
    setName('')
    setCode('')
    setAddress('')
    setCountryCode('')
    setPhoneNumber('')
    setNotes('')
    setIsActive(true)
    setFormOpen(true)
    setNotice(null)
  }

  const startEdit = (item: Warehouse) => {
    if (!hasUpdate) return
    setEditing(item)
    setName(item.name)
    setCode(item.code || '')
    setAddress(item.address || '')
    setCountryCode(item.countryCode || '')
    setPhoneNumber(item.phoneNumber || '')
    setNotes(item.notes || '')
    setIsActive(item.isActive)
    setFormOpen(true)
    setNotice(null)
  }

  const closeForm = () => {
    setFormOpen(false)
    setEditing(null)
    setName('')
    setCode('')
    setAddress('')
    setCountryCode('')
    setPhoneNumber('')
    setNotes('')
    setIsActive(true)
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const cleanName = name.trim()
    const cleanCode = code.trim()
    const cleanAddress = address.trim()
    const cleanCountry = countryCode.trim()
    const cleanPhone = phoneNumber.trim()

    if (!cleanName || !cleanCode) {
      setNotice({ type: 'error', text: 'يرجى إدخال اسم المخزن وكود المخزن.' })
      return
    }

    setSaving(true)
    setNotice(null)
    try {
      if (editing) {
        await inventoryApi.updateWarehouse(editing.id, {
          name: cleanName,
          code: cleanCode,
          address: cleanAddress,
          countryCode: cleanCountry || null,
          phoneNumber: cleanPhone,
          notes: notes.trim(),
          isActive
        })
        setNotice({ type: 'success', text: 'تم تحديث المخزن بنجاح.' })
      } else {
        await inventoryApi.createWarehouse({
          name: cleanName,
          code: cleanCode,
          address: cleanAddress,
          countryCode: cleanCountry || null,
          phoneNumber: cleanPhone,
          notes: notes.trim(),
          isActive
        })
        setNotice({ type: 'success', text: 'تمت إضافة المخزن بنجاح.' })
      }
      closeForm()
      await load()
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'تعذر حفظ المخزن.' })
    } finally {
      setSaving(false)
    }
  }

  const remove = async (item: Warehouse) => {
    if (!hasDelete) return
    if (!window.confirm(`هل أنت متأكد من حذف المخزن «${item.name}»؟`)) return
    setSaving(true)
    setNotice(null)
    try {
      await inventoryApi.deleteWarehouse(item.id)
      setNotice({ type: 'success', text: 'تم حذف المخزن بنجاح.' })
      if (editing?.id === item.id) closeForm()
      await load()
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'تعذر حذف المخزن.' })
    } finally {
      setSaving(false)
    }
  }

  const disabled = loading || saving

  const content = (
      <div className="view-container">
        <div className="view-header" style={{ marginBottom: '1.5rem' }}>
          <div>
            <h1 className="view-header-title">إدارة المخازن والمستودعات</h1>
            <p className="view-header-subtitle">أضف المخازن والمستودعات المادية لربطها بطلبات الشحن وتتبع مخزون المنتجات.</p>
          </div>
        </div>

        <div className="io-data-surface">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem 1rem', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)' }}>
            <strong style={{ fontSize: '0.85rem' }}>قائمة المخازن</strong>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{toArabicNumerals(totalEntries)} مخزن</span>
              <button type="button" className="io-button io-button-ghost" onClick={() => void load()} disabled={disabled} style={{ fontSize: '0.8rem', padding: '0.3rem 0.6rem' }}><RefreshIcon /> تحديث</button>
              {hasCreate && <button type="button" className="io-button io-button-primary" onClick={startAdd} disabled={disabled} style={{ fontSize: '0.8rem', padding: '0.3rem 0.6rem' }}><PlusIcon /> إضافة مخزن</button>}
            </div>
          </div>

          <div className="ao-filter-bar" style={{ flexWrap: 'wrap' }}>
            <input type="text" placeholder="ابحث بالاسم، الكود، العنوان، الهاتف..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} />
            <select style={{ padding: '0.5rem 0.75rem', border: '1px solid var(--border-color)', borderRadius: 6, background: 'var(--bg-primary)', fontSize: '0.8rem', fontFamily: 'var(--font-body)', width: 110, flexShrink: 0 }} value={activeFilter === undefined ? -1 : activeFilter ? 1 : 0} onChange={(e) => { const v = Number(e.target.value); setActiveFilter(v === -1 ? undefined : v === 1); setPage(1) }}>
              <option value={-1}>الكل</option>
              <option value={1}>نشط</option>
              <option value={0}>غير نشط</option>
            </select>
          </div>

          <StatusBanner notice={notice} />

          {formOpen && (
            <form className="ss-multi-editor" onSubmit={submit} style={{ borderBottom: '1px solid var(--border-color)' }}>
              <div className="ss-multi-editor-full">
                <span className="ss-editor-kicker">{editing ? 'تعديل السجل' : 'سجل جديد'}</span>
                <h3>{editing ? 'تعديل المخزن' : 'إضافة مخزن'}</h3>
              </div>
              <div className="ss-editor-field">
                <label htmlFor="wh-name">اسم المخزن</label>
                <input id="wh-name" className="ss-input" value={name} onChange={(event) => setName(event.target.value)} placeholder="مثال: المخزن الرئيسي، مخزن أكتوبر" autoFocus disabled={saving} />
              </div>
              <div className="ss-editor-field">
                <label htmlFor="wh-code">كود المخزن (فريد)</label>
                <input id="wh-code" className="ss-input" value={code} onChange={(event) => setCode(event.target.value)} placeholder="مثال: WH-MAIN, WH-OCT" disabled={saving} />
              </div>
              <div className="ss-editor-field">
                <label htmlFor="wh-country">الدولة</label>
                {countries.length > 0 ? (
                  <select id="wh-country" className="ss-input" value={countryCode} onChange={(event) => setCountryCode(event.target.value)} disabled={saving}>
                    <option value="">اختر الدولة</option>
                    {countries.map((ct) => <option key={ct.id} value={ct.code}>{ct.nameAr} ({ct.code})</option>)}
                  </select>
                ) : (
                  <input id="wh-country" className="ss-input" value={countryCode} onChange={(event) => setCountryCode(event.target.value)} placeholder="مثال: EG" disabled={saving} />
                )}
              </div>
              <div className="ss-editor-field">
                <label htmlFor="wh-phone">رقم الهاتف</label>
                <input id="wh-phone" className="ss-input" value={phoneNumber} onChange={(event) => setPhoneNumber(event.target.value)} placeholder="مثال: 01012345678" disabled={saving} />
              </div>
              <div className="ss-editor-field ss-multi-editor-full">
                <label htmlFor="wh-address">العنوان التفصيلي</label>
                <input id="wh-address" className="ss-input" value={address} onChange={(event) => setAddress(event.target.value)} placeholder="الشارع، المنطقة، المدينة" disabled={saving} />
              </div>
              <div className="ss-editor-field ss-multi-editor-full">
                <label htmlFor="wh-notes">ملاحظات</label>
                <input id="wh-notes" className="ss-input" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="أي ملاحظات إضافية عن المستودع" disabled={saving} />
              </div>
              <div className="ss-editor-field ss-multi-editor-full">
                <label className="ss-checkbox-label">
                  <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} disabled={saving} />
                  <span>نشط (متاح للربط بالطلبات والمخزون)</span>
                </label>
              </div>
              <div className="ss-multi-editor-actions">
                <Button variant="ghost" onClick={closeForm} disabled={saving}>إلغاء</Button>
                <Button type="submit" disabled={saving}>{saving ? 'جاري الحفظ...' : editing ? 'حفظ التعديل' : 'إضافة السجل'}</Button>
              </div>
            </form>
          )}

          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '150px', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
              جاري التحميل...
            </div>
          ) : entries.length === 0 ? (
            <div className="io-empty-state">
              <h3>لا توجد مخازن</h3>
              <p>{search || activeFilter !== undefined ? 'لا توجد نتائج تطابق معايير البحث.' : 'لم يتم إضافة أي مخازن بعد.'}</p>
            </div>
          ) : (
            <>
              <div className="io-table-scroll ao-table-scroll">
                <table className="io-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>الكود</th>
                      <th>الاسم</th>
                      <th>الدولة</th>
                      <th>الهاتف</th>
                      <th>العنوان</th>
                      <th>الحالة</th>
                      <th>افتراضي</th>
                      <th>المواقع</th>
                      <th className="io-actions-column">الإجراءات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((item, index) => (
                      <tr key={item.id}>
                        <td><span className="io-row-number">{(page - 1) * pageSize + index + 1}</span></td>
                        <td><span style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{item.code}</span></td>
                        <td><span className="io-item-name">{item.name}</span></td>
                        <td><span>{countries.find((ct) => ct.code === item.countryCode)?.nameAr ?? item.countryCode ?? '—'}</span></td>
                        <td><span>{item.phoneNumber || '—'}</span></td>
                        <td><span>{item.address || '—'}</span></td>
                        <td>
                          <span style={{ background: 'var(--bg-secondary)', padding: '2px 6px', borderRadius: '4px', fontSize: '0.85rem' }}>
                            {item.isActive ? 'نشط' : 'غير نشط'}
                          </span>
                        </td>
                        <td>{item.isDefault ? 'نعم' : '—'}</td>
                        <td>{toArabicNumerals(String(item._count?.storageLocations ?? 0))}</td>
                        <td className="io-actions-column">
                          <div className="io-row-actions">
                            {hasUpdate && <button className="io-icon-button" style={{ color: 'var(--text-secondary)' }} onClick={() => startEdit(item)} disabled={saving} aria-label={`تعديل ${item.name}`} title="تعديل"><EditIcon /></button>}
                            {hasDelete && <button className="io-icon-button io-icon-delete" onClick={() => void remove(item)} disabled={saving} aria-label={`حذف ${item.name}`} title="حذف"><TrashIcon /></button>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {totalPages > 1 && (
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem', padding: '0.75rem 1rem', borderTop: '1px solid var(--border-color)' }}>
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    style={{ padding: '0.4rem 0.8rem', border: '1px solid var(--border-color)', borderRadius: 6, background: 'var(--bg-primary)', cursor: page <= 1 ? 'default' : 'pointer', opacity: page <= 1 ? 0.4 : 1, fontSize: '0.8rem' }}
                  >
                    السابق
                  </button>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    الصفحة {toArabicNumerals(page)} من {toArabicNumerals(totalPages)}
                  </span>
                  <button
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                    style={{ padding: '0.4rem 0.8rem', border: '1px solid var(--border-color)', borderRadius: 6, background: 'var(--bg-primary)', cursor: page >= totalPages ? 'default' : 'pointer', opacity: page >= totalPages ? 0.4 : 1, fontSize: '0.8rem' }}
                  >
                    التالي
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
  )

  if (embedded) {
    return content
  }

  return (
    <DashboardLayout navigate={navigate}>
      {content}
    </DashboardLayout>
  )
}
