import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import DashboardLayout from '../../components/DashboardLayout/DashboardLayout'
import { toArabicNumerals } from '../../utils/arabicNumerals'
import RemoteImage from '../../components/RemoteImage/RemoteImage'
import { catalogApi, type Brand } from '../../lib/api'
import { useCurrentUser } from '../../hooks/useCurrentUser'
import { useFilePicker } from '../../lib/useImageUpload'
import '../SystemSettings/SystemSettings.css'

interface BrandsManagementProps {
  navigate: (path: string) => void
  embedded?: boolean
}

type Notice = {
  type: 'success' | 'error' | 'info'
  text: string
}

/** Big enough for a reference list; these are never browsed page by page. */
const REFERENCE_PAGE_SIZE = 200

function Icon({ children, size = 18 }: { children: ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
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
const TagIcon = () => <Icon><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" /><line x1="7" y1="7" x2="7.01" y2="7" /></Icon>

function StatusBanner({ notice }: { notice: Notice | null }) {
  if (!notice) return null
  return (
    <div className={`ss-status ss-status-${notice.type}`} role={notice.type === 'error' ? 'alert' : 'status'}>
      <span className="ss-status-icon">{notice.type === 'success' ? <CheckIcon /> : notice.type === 'error' ? <AlertIcon /> : <InfoIcon />}</span>
      <span>{notice.text}</span>
    </div>
  )
}

function Button({ children, variant = 'primary', type = 'button', onClick, disabled = false, className = '' }: {
  children: ReactNode; variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; type?: 'button' | 'submit'; onClick?: () => void; disabled?: boolean; className?: string
}) {
  return <button type={type} className={`ss-button ss-button-${variant} ${className}`} onClick={onClick} disabled={disabled}>{children}</button>
}

function EmptyState({ singular, onAdd, hasSearch }: { singular: string; onAdd: () => void; hasSearch: boolean }) {
  return (
    <div className="ss-empty-state">
      <div className="ss-empty-mark"><span>+</span></div>
      <h3>{hasSearch ? 'لا توجد نتائج مطابقة' : `لا توجد ${singular} مضافة بعد`}</h3>
      <p>{hasSearch ? 'جرّب تغيير كلمات البحث أو امسح الفلتر الحالي.' : `ابدأ بإضافة أول ${singular} ليظهر هنا.`}</p>
      {!hasSearch && <Button variant="secondary" onClick={onAdd}><PlusIcon /> إضافة {singular}</Button>}
    </div>
  )
}

function LoadingState() {
  return (
    <div className="ss-loading-list" aria-label="جاري التحميل">
      {[1, 2, 3, 4].map((item) => <div className="ss-skeleton-row" key={item}><span /><span /><span /></div>)}
    </div>
  )
}

function BrandsTab() {
  const [items, setItems] = useState<Brand[]>([])
  const [total, setTotal] = useState(0)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Brand | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [logoUrl, setLogoUrl] = useState('')

  // Store the selected logo in R2 and keep the returned asset address for save.
  const logoPicker = useFilePicker((url) => {
    if (url) setLogoUrl(url)
  })
  const [notice, setNotice] = useState<Notice | null>(null)
  const [lastLoaded, setLastLoaded] = useState<Date | null>(null)

  // Permissions are the server's answer, not a copy of the role names saved at
  // login. An owner holds all of them implicitly, so there is no separate
  // owner branch to remember here.
  const { hasPermission } = useCurrentUser()
  const hasCreate = hasPermission('Permissions.CreateBrand')
  const hasUpdate = hasPermission('Permissions.UpdateBrand')
  const hasDelete = hasPermission('Permissions.DeleteBrand')

  const load = useCallback(async (showLoader = true) => {
    if (showLoader) setLoading(true)
    try {
      const page = await catalogApi.listBrands({ pageSize: REFERENCE_PAGE_SIZE })
      setItems(page.items)
      setTotal(page.total)
      setLastLoaded(new Date())
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'تعذر تحميل الماركات.' })
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load])

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter((item) => item.name.toLowerCase().includes(q) || (item.description && item.description.toLowerCase().includes(q)))
  }, [items, query])

  const startAdd = () => {
    if (!hasCreate) return; setEditing(null); setName(''); setDescription(''); setIsActive(true); setLogoUrl(''); setFormOpen(true); setNotice(null)
  }
  const startEdit = (item: Brand) => {
    if (!hasUpdate) return; setEditing(item); setName(item.name); setDescription(item.description || ''); setIsActive(item.isActive); setLogoUrl(item.logoUrl || ''); setFormOpen(true); setNotice(null)
  }
  const closeForm = () => { setFormOpen(false); setEditing(null); setName(''); setDescription(''); setIsActive(true); setLogoUrl('') }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const cleanName = name.trim()
    if (!cleanName) { setNotice({ type: 'error', text: 'يرجى إدخال اسم الماركة.' }); return }
    setSaving(true); setNotice(null)
    try {
      const payload = {
        name: cleanName,
        description: description.trim() || null,
        logoUrl: logoUrl.trim() || null,
        isActive,
      }
      if (editing) {
        await catalogApi.updateBrand(editing.id, payload)
        setNotice({ type: 'success', text: 'تم تحديث الماركة بنجاح.' })
      } else {
        await catalogApi.createBrand(payload)
        setNotice({ type: 'success', text: 'تمت إضافة الماركة بنجاح.' })
      }
      closeForm(); await load(false)
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'تعذر حفظ البيانات.' })
    } finally { setSaving(false) }
  }

  const remove = async (item: Brand) => {
    if (!hasDelete) return
    if (!window.confirm(`هل أنت متأكد من حذف الماركة «${item.name}»؟`)) return
    setSaving(true); setNotice(null)
    try {
      await catalogApi.deleteBrand(item.id)
      setNotice({ type: 'success', text: 'تم حذف الماركة بنجاح.' })
      if (editing?.id === item.id) closeForm()
      await load(false)
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'تعذر حذف الماركة.' })
    } finally { setSaving(false) }
  }

  return (
    <section className="ss-module animate-fade-in">
      <div className="ss-module-heading">
        <div className="ss-module-icon"><TagIcon /></div>
        <div>
          <p className="ss-eyebrow">بيانات مرجعية</p>
          <h2>إدارة الماركات (Brands)</h2>
          <p>أضف الماركات والعلامات التجارية التي تنتمي إليها المنتجات في النظام.</p>
        </div>
      </div>
      <div className="ss-module-actions">
        <span className="ss-count-chip"><strong>{total}</strong> ماركات</span>
        <Button variant="ghost" onClick={() => void load()} disabled={loading || saving}><RefreshIcon /> تحديث</Button>
        {hasCreate && <Button onClick={startAdd} disabled={saving}><PlusIcon /> إضافة ماركة</Button>}
      </div>
      <StatusBanner notice={notice} />
      <div className="ss-list-toolbar">
        <label className="ss-search">
          <SearchIcon />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ابحث باسم الماركة أو الوصف..." aria-label="البحث في الماركات" />
        </label>
        <span className="ss-last-loaded">{lastLoaded ? `آخر تحديث ${lastLoaded.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}` : 'جاري تجهيز القائمة'}</span>
      </div>
      {formOpen && (
        <form className="ss-multi-editor" onSubmit={submit}>
          <div className="ss-multi-editor-full">
            <span className="ss-editor-kicker">{editing ? 'تعديل السجل' : 'سجل جديد'}</span>
            <h3>{editing ? 'تعديل الماركة' : 'إضافة ماركة'}</h3>
          </div>
          <div className="ss-editor-field">
            <label htmlFor="brand-name">اسم الماركة</label>
            <input id="brand-name" className="ss-input" value={name} onChange={(event) => setName(event.target.value)} placeholder="مثال: آبل، سامسونج" autoFocus disabled={saving} />
          </div>
          <div className="ss-editor-field">
            <label htmlFor="brand-desc">الوصف</label>
            <input id="brand-desc" className="ss-input" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="وصف قصير للماركة" disabled={saving} />
          </div>
          <div className="ss-editor-field ss-multi-editor-full">
            <label htmlFor="brand-logo">شعار الماركة</label>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem' }}>
              <input id="brand-logo" ref={logoPicker.inputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" style={{ display: 'none' }} onChange={(e) => void logoPicker.onChange(e)} />
              <button type="button" className="io-button" onClick={logoPicker.openPicker} disabled={logoPicker.uploading || saving}>{logoPicker.uploading ? 'جاري الرفع...' : 'اختيار صورة'}</button>
              {logoUrl.trim() && <RemoteImage path={logoUrl.trim()} alt="Brand Logo" className="ss-file-preview" />}
              {logoUrl.trim() && <button type="button" className="io-button io-button-ghost" onClick={() => setLogoUrl('')} disabled={saving}>إزالة الصورة</button>}
            </div>
          </div>
          <div className="ss-editor-field ss-multi-editor-full">
            <label className="ss-checkbox-label">
              <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} disabled={saving} />
              <span>نشطة (متاحة للاستخدام في كرت المنتج)</span>
            </label>
          </div>
          <div className="ss-multi-editor-actions">
            <Button variant="ghost" onClick={closeForm} disabled={saving}>إلغاء</Button>
            <Button type="submit" disabled={saving}>{saving ? 'جاري الحفظ...' : editing ? 'حفظ التعديل' : 'إضافة السجل'}</Button>
          </div>
        </form>
      )}
      <div className="ss-data-surface">
        {loading ? <LoadingState /> : filteredItems.length === 0 ? <EmptyState singular="ماركة" onAdd={startAdd} hasSearch={Boolean(query.trim())} /> : (
          <div className="ss-table-scroll">
            <table className="ss-table">
              <thead><tr><th>#</th><th>الشعار</th><th>الاسم</th><th>الوصف</th><th>الرابط (Slug)</th><th>المنتجات</th><th>الحالة</th><th className="ss-actions-column">الإجراءات</th></tr></thead>
              <tbody>
                {filteredItems.map((item, index) => (
                  <tr key={item.id}>
                    <td><span className="ss-row-number">{index + 1}</span></td>
                    <td><span className="ss-item-name">{item.name}</span></td>
                    <td><span>{item.description || '—'}</span></td>
                    <td><span dir="ltr">{item.slug || '—'}</span></td>
                    <td>{toArabicNumerals(String(item._count?.products ?? 0))}</td>
                    <td><span className="ss-related-badge" style={!item.isActive ? { background: 'var(--border-color)', color: 'var(--text-muted)' } : undefined}>{item.isActive ? 'نشط' : 'غير نشط'}</span></td>
                    <td className="ss-actions-column">
                      <div className="ss-row-actions">
                        {hasUpdate && <button className="ss-icon-button ss-icon-edit" onClick={() => startEdit(item)} disabled={saving} aria-label={`تعديل ${item.name}`} title="تعديل"><EditIcon /></button>}
                        {hasDelete && <button className="ss-icon-button ss-icon-delete" onClick={() => void remove(item)} disabled={saving} aria-label={`حذف ${item.name}`} title="حذف"><TrashIcon /></button>}
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

export default function BrandsManagement({ navigate, embedded = false }: BrandsManagementProps) {
  const content = (
    <div className="view-container">
      <BrandsTab />
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
