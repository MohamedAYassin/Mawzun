import { useCallback, useEffect, useState, type FormEvent } from 'react'
import DashboardLayout from '../../components/DashboardLayout/DashboardLayout'
import { shippingApi, type City, type Governorate } from '../../lib/api'
import { toArabicNumerals } from '../../utils/arabicNumerals'
import '../SystemSettings/SystemSettings.css'

interface CitiesManagementProps {
  navigate: (path: string) => void
  embedded?: boolean
}

function Icon({ children, size = 18 }: { children: React.ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  )
}

const PlusIcon = () => <Icon><path d="M12 5v14M5 12h14" /></Icon>
const RefreshIcon = () => <Icon><path d="M20 11a8.1 8.1 0 0 0-14.8-4L3 10" /><path d="M3 5v5h5" /><path d="M4 13a8.1 8.1 0 0 0 14.8 4L21 14" /><path d="M21 19v-5h-5" /></Icon>
const SearchIcon = () => <Icon size={16}><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></Icon>
const EditIcon = () => <Icon size={16}><path d="m4 16-.7 4.7L8 20l10.7-10.7a2.1 2.1 0 0 0-3-3L5 17" /><path d="m14.5 7.5 2 2" /></Icon>
const TrashIcon = () => <Icon size={16}><path d="M4 7h16M10 11v5M14 11v5M6 7l1 13h10l1-13M9 7V4h6v3" /></Icon>
const CheckIcon = () => <Icon size={16}><path d="m5 12 4 4L19 6" /></Icon>
const AlertIcon = () => <Icon size={16}><path d="M12 9v4M12 17h.01" /><path d="M10.3 4.4 2.6 18a1.4 1.4 0 0 0 1.2 2h16.4a1.4 1.4 0 0 0 1.2-2L13.7 4.4a2 2 0 0 0-3.4 0Z" /></Icon>
const InfoIcon = () => <Icon size={16}><circle cx="12" cy="12" r="9" /><path d="M12 10v6M12 7h.01" /></Icon>
const MapIcon = () => <Icon><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Z" /><path d="M9 3v15M15 6v15" /></Icon>

type Notice = { type: 'success' | 'error'; text: string }

const pageSize = 10

export default function CitiesManagement({ navigate, embedded = false }: CitiesManagementProps) {
  const [all, setAll] = useState<City[]>([])
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [governorateFilter, setGovernorateFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)

  // Loaded once for the form dropdown
  const [governorates, setGovernorates] = useState<Governorate[]>([])

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<City | null>(null)
  const [name, setName] = useState('')
  const [governorateId, setGovernorateId] = useState('')
  const [code, setCode] = useState('')
  const [shippingCost, setShippingCost] = useState('')
  const [isActive, setIsActive] = useState(true)

  useEffect(() => {
    void shippingApi.listGovernorates().then((page) => setGovernorates(page.items)).catch(() => {})
  }, [])

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const result = await shippingApi.listCities()
      setAll(result.items)
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'تعذر تحميل البيانات.' })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadData()
  }, [loadData])

  // Search and the governorate filter run here; the server only paginates.
  const filtered = all.filter((city) => {
    if (governorateFilter && city.governorateId !== governorateFilter) return false
    const q = search.trim().toLowerCase()
    if (!q) return true
    return city.name.toLowerCase().includes(q) || city.governorate.name.toLowerCase().includes(q)
  })
  const totalEntries = filtered.length
  const totalPages = Math.max(1, Math.ceil(totalEntries / pageSize))
  const items = filtered.slice((page - 1) * pageSize, page * pageSize)

  const startAdd = () => {
    setEditing(null)
    setName('')
    setGovernorateId(governorates[0]?.id || '')
    setCode('')
    setShippingCost('')
    setIsActive(true)
    setFormOpen(true)
  }

  const startEdit = (city: City) => {
    setEditing(city)
    setName(city.name)
    setGovernorateId(city.governorateId)
    setCode(city.code ?? '')
    setShippingCost(String(city.shippingCost))
    setIsActive(city.isActive)
    setFormOpen(true)
  }

  const closeForm = () => {
    setFormOpen(false)
    setEditing(null)
    setName('')
    setGovernorateId('')
    setCode('')
    setShippingCost('')
    setIsActive(true)
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const cleanName = name.trim()
    if (!cleanName || !governorateId) {
      setNotice({ type: 'error', text: 'يرجى إدخال اسم المدينة واختيار المحافظة.' })
      return
    }

    setSaving(true)
    setNotice(null)
    try {
      const payload = {
        name: cleanName,
        code: code.trim() || null,
        shippingCost: shippingCost.trim() === '' ? 0 : Math.max(0, Number(shippingCost) || 0),
        isActive,
      }
      if (editing) {
        await shippingApi.updateCity(governorateId, editing.id, payload)
        setNotice({ type: 'success', text: 'تم تحديث المدينة بنجاح.' })
      } else {
        await shippingApi.createCity(governorateId, payload)
        setNotice({ type: 'success', text: 'تمت إضافة المدينة بنجاح.' })
      }
      closeForm()
      await loadData()
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'تعذر حفظ المدينة.' })
    } finally {
      setSaving(false)
    }
  }

  const remove = async (city: City) => {
    if (!window.confirm(`هل أنت متأكد من حذف المدينة «${city.name}»؟`)) return
    setSaving(true)
    setNotice(null)
    try {
      await shippingApi.deleteCity(city.governorateId, city.id)
      setNotice({ type: 'success', text: 'تم حذف المدينة بنجاح.' })
      if (editing?.id === city.id) closeForm()
      await loadData()
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'تعذر حذف المدينة.' })
    } finally {
      setSaving(false)
    }
  }

  const content = (
      <div className="view-container">
        <section className="ss-module animate-fade-in">
          <div className="ss-module-heading">
            <div className="ss-module-icon"><MapIcon /></div>
            <div>
              <p className="ss-eyebrow">بيانات مرجعية</p>
              <h2>إدارة المدن</h2>
              <p>اربط كل مدينة بمحافظتها لتظهر عناوين الشحن بشكل صحيح.</p>
            </div>
          </div>

          <div className="ss-module-actions">
            <span className="ss-count-chip"><strong>{toArabicNumerals(totalEntries)}</strong> مدينة</span>
            <button className="ss-button ss-button-ghost" onClick={() => void loadData()} disabled={loading || saving}><RefreshIcon /> تحديث</button>
            <button className="ss-button ss-button-primary" onClick={startAdd} disabled={saving || governorates.length === 0}><PlusIcon /> إضافة مدينة</button>
          </div>

          {notice && (
            <div className={`ss-status ss-status-${notice.type}`} role={notice.type === 'error' ? 'alert' : 'status'}>
              <span className="ss-status-icon">{notice.type === 'success' ? <CheckIcon /> : <AlertIcon />}</span>
              <span>{notice.text}</span>
            </div>
          )}

          <div className="ss-list-toolbar">
            <label className="ss-search">
              <SearchIcon />
              <input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1) }}
                placeholder="ابحث باسم المدينة أو المحافظة..."
                aria-label="البحث في المدن"
              />
            </label>
            <select
              value={governorateFilter}
              onChange={(e) => { setGovernorateFilter(e.target.value); setPage(1) }}
              style={{ padding: '0.4rem 0.6rem', border: '1px solid var(--border-color)', borderRadius: 6, fontSize: '0.8rem', background: 'var(--bg-primary)' }}
            >
              <option value="">كل المحافظات</option>
              {governorates.map((g) => <option value={g.id} key={g.id}>{g.name}</option>)}
            </select>
          </div>

          {governorates.length === 0 && !loading && (
            <div className="ss-inline-info"><InfoIcon /> أضف محافظة أولاً حتى تتمكن من إنشاء المدن.</div>
          )}

          {formOpen && (
            <form className="ss-editor" onSubmit={submit}>
              <div className="ss-editor-copy">
                <span className="ss-editor-kicker">{editing ? 'تعديل السجل' : 'سجل جديد'}</span>
                <h3>{editing ? 'تعديل مدينة' : 'إضافة مدينة'}</h3>
                <p>اختر المحافظة التابعة لها المدينة.</p>
              </div>
              <div className="ss-editor-field">
                <label htmlFor="city-name">اسم المدينة</label>
                <input id="city-name" className="ss-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="مثال: مدينة نصر" autoFocus disabled={saving} />
              </div>
              <div className="ss-editor-field">
                <label htmlFor="city-governorate">المحافظة</label>
                {/* A city belongs to exactly one governorate and the update
                    route is nested under it, so the parent cannot be changed
                    by editing — that would be a delete-and-recreate. */}
                <select id="city-governorate" className="ss-input" value={governorateId} onChange={(e) => setGovernorateId(e.target.value)} disabled={saving || Boolean(editing)}>
                  <option value="">اختر المحافظة</option>
                  {governorates.map((g) => <option value={g.id} key={g.id}>{g.name}</option>)}
                </select>
              </div>
              <div className="ss-editor-field">
                <label htmlFor="city-code">الكود</label>
                <input id="city-code" className="ss-input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="مثال: CAI-NSR" disabled={saving} style={{ direction: 'ltr' }} />
              </div>
              <div className="ss-editor-field">
                <label htmlFor="city-cost">تكلفة الشحن (ج.م)</label>
                <input id="city-cost" className="ss-input" type="number" min="0" step="0.01" value={shippingCost} onChange={(e) => setShippingCost(e.target.value)} disabled={saving} style={{ direction: 'ltr' }} />
              </div>
              <div className="ss-editor-field"><label className="ss-checkbox-label"><input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} disabled={saving} /> مدينة نشطة</label></div>
              <div className="ss-editor-actions">
                <button className="ss-button ss-button-ghost" type="button" onClick={closeForm} disabled={saving}>إلغاء</button>
                <button className="ss-button ss-button-primary" type="submit" disabled={saving}>{saving ? 'جاري الحفظ...' : editing ? 'حفظ التعديل' : 'إضافة السجل'}</button>
              </div>
            </form>
          )}

          <div className="ss-data-surface">
            {loading ? (
              <div className="ss-loading-list" aria-label="جاري التحميل">
                {[1, 2, 3, 4].map((item) => <div className="ss-skeleton-row" key={item}><span /><span /><span /></div>)}
              </div>
            ) : items.length === 0 ? (
              <div className="ss-empty-state">
                <div className="ss-empty-mark"><span>+</span></div>
                <h3>{search.trim() || governorateFilter !== '' ? 'لا توجد نتائج مطابقة' : 'لا توجد مدن مضافة بعد'}</h3>
                <p>{search.trim() || governorateFilter !== '' ? 'جرّب تغيير كلمات البحث أو امسح الفلتر الحالي.' : 'ابدأ بإضافة أول مدينة ليظهر هنا.'}</p>
              </div>
            ) : (
              <>
                <div className="ss-table-scroll">
                  <table className="ss-table">
                    <thead><tr><th>#</th><th>المدينة</th><th>المحافظة</th><th>الكود</th><th>تكلفة الشحن</th><th>الحالة</th><th className="ss-actions-column">الإجراءات</th></tr></thead>
                    <tbody>
                      {items.map((city, index) => (
                        <tr key={city.id}>
                          <td><span className="ss-row-number">{toArabicNumerals((page - 1) * pageSize + index + 1)}</span></td>
                          <td><span className="ss-item-name">{city.name}</span></td>
                          <td><span className="ss-related-badge">{city.governorate.name || 'غير محددة'}</span></td>
                          <td><span dir="ltr">{city.code || '—'}</span></td>
                          <td>{toArabicNumerals(Number(city.shippingCost).toFixed(2))}</td>
                          <td><span className="ss-related-badge" style={!city.isActive ? { background: 'var(--border-color)', color: 'var(--text-muted)' } : undefined}>{city.isActive ? 'نشطة' : 'موقوفة'}</span></td>
                          <td className="ss-actions-column">
                            <div className="ss-row-actions">
                              <button className="ss-icon-button ss-icon-edit" onClick={() => startEdit(city)} disabled={saving} aria-label={`تعديل ${city.name}`} title="تعديل"><EditIcon /></button>
                              <button className="ss-icon-button ss-icon-delete" onClick={() => void remove(city)} disabled={saving} aria-label={`حذف ${city.name}`} title="حذف"><TrashIcon /></button>
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
                      الصفحة {toArabicNumerals(page)} من {toArabicNumerals(totalPages)} ({toArabicNumerals(totalEntries)} مدينة)
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
        </section>
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
