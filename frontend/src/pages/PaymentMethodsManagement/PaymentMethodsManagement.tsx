import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import DashboardLayout from '../../components/DashboardLayout/DashboardLayout'
import { ActiveBadge } from '../shared/ManagementUi'
import { salesApi, type OrderConfigEntry } from '../../lib/api'
import '../SystemSettings/SystemSettings.css'

interface PaymentMethodsManagementProps {
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
const SearchIcon = () => <Icon size={16}><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></Icon>
const EditIcon = () => <Icon size={16}><path d="m4 16-.7 4.7L8 20l10.7-10.7a2.1 2.1 0 0 0-3-3L5 17" /><path d="m14.5 7.5 2 2" /></Icon>
const TrashIcon = () => <Icon size={16}><path d="M4 7h16M10 11v5M14 11v5M6 7l1 13h10l1-13M9 7V4h6v3" /></Icon>
const CheckIcon = () => <Icon size={16}><path d="m5 12 4 4L19 6" /></Icon>
const AlertIcon = () => <Icon size={16}><path d="M12 9v4M12 17h.01" /><path d="M10.3 4.4 2.6 18a1.4 1.4 0 0 0 1.2 2h16.4a1.4 1.4 0 0 0 1.2-2L13.7 4.4a2 2 0 0 0-3.4 0Z" /></Icon>
const InfoIcon = () => <Icon size={16}><circle cx="12" cy="12" r="9" /><path d="M12 10v6M12 7h.01" /></Icon>
const CreditCardIcon = () => <Icon><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18M7 15h4" /></Icon>

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

function LoadingState() {
  return <div className="ss-loading">جاري التحميل...</div>
}

function EmptyState({ singular, onAdd, hasSearch }: { singular: string; onAdd: () => void; hasSearch: boolean }) {
  if (hasSearch) return <div className="ss-empty">لا توجد نتائج تطابق البحث.</div>
  return (
    <div className="ss-empty">
      <span className="ss-empty-icon"><CreditCardIcon /></span>
      <h3>لا توجد {singular} بعد</h3>
      <p>أضف {singular} جديدة لتبدأ.</p>
      <Button onClick={onAdd}>إضافة {singular}</Button>
    </div>
  )
}

export default function PaymentMethodsManagement({ navigate, embedded = false }: PaymentMethodsManagementProps) {
  const [items, setItems] = useState<OrderConfigEntry[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<OrderConfigEntry | null>(null)
  const [name, setName] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [lastLoaded, setLastLoaded] = useState<Date | null>(null)

  const load = useCallback(async (showLoader = true) => {
    if (showLoader) setLoading(true)
    try {
      const result = await salesApi.listPaymentMethods()
      setItems(result)
      setLastLoaded(new Date())
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'تعذر تحميل طرق الدفع.' })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    if (!normalizedQuery) return items
    return items.filter((item) => item.name.toLowerCase().includes(normalizedQuery))
  }, [items, query])

  const startAdd = () => {
    setEditing(null)
    setName('')
    setIsActive(true)
    setFormOpen(true)
  }

  const startEdit = (item: OrderConfigEntry) => {
    setEditing(item)
    setName(item.name)
    setIsActive(item.isActive)
    setFormOpen(true)
  }

  const closeForm = () => {
    setFormOpen(false)
    setEditing(null)
    setName('')
    setIsActive(true)
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const cleanName = name.trim()
    if (!cleanName) {
      setNotice({ type: 'error', text: 'يرجى إدخال اسم طريقة الدفع.' })
      return
    }

    setSaving(true)
    setNotice(null)
    try {
      if (editing) {
        await salesApi.updatePaymentMethod(editing.id, { name: cleanName, isActive })
        setNotice({ type: 'success', text: 'تم تحديث طريقة الدفع بنجاح.' })
      } else {
        await salesApi.createPaymentMethod({ name: cleanName, isActive })
        setNotice({ type: 'success', text: 'تمت إضافة طريقة الدفع بنجاح.' })
      }
      closeForm()
      await load(false)
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'تعذر حفظ البيانات.' })
    } finally {
      setSaving(false)
    }
  }

  const remove = async (item: OrderConfigEntry) => {
    if (!window.confirm(`هل أنت متأكد من حذف طريقة الدفع «${item.name}»؟`)) return
    setSaving(true)
    setNotice(null)
    try {
      await salesApi.deletePaymentMethod(item.id)
      setNotice({ type: 'success', text: 'تم حذف طريقة الدفع بنجاح.' })
      if (editing?.id === item.id) closeForm()
      await load(false)
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'تعذر حذف البيانات.' })
    } finally {
      setSaving(false)
    }
  }

  const content = (
      <div className="ss-container animate-fade-in">
        <section className="ss-module animate-fade-in">
          <div className="ss-module-heading">
            <div className="ss-module-icon"><CreditCardIcon /></div>
            <div>
              <p className="ss-eyebrow">بيانات مرجعية</p>
              <h2>طرق الدفع</h2>
              <p>الطرق التي يمكن للعميل استخدامها لسداد الطلب.</p>
            </div>
          </div>

          <div className="ss-module-actions">
            <span className="ss-count-chip"><strong>{items.length}</strong> طرق دفع</span>
            <Button variant="ghost" onClick={() => void load()} disabled={loading || saving}><RefreshIcon /> تحديث</Button>
            <Button onClick={startAdd} disabled={saving}><PlusIcon /> إضافة طريقة دفع</Button>
          </div>

          <StatusBanner notice={notice} />

          <div className="ss-list-toolbar">
            <label className="ss-search">
              <SearchIcon />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ابحث في طرق الدفع..." aria-label="البحث في طرق الدفع" />
            </label>
            <span className="ss-last-loaded">{lastLoaded ? `آخر تحديث ${lastLoaded.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}` : 'جاري تجهيز القائمة'}</span>
          </div>

          {formOpen && (
            <form className="ss-editor" onSubmit={submit}>
              <div className="ss-editor-copy">
                <span className="ss-editor-kicker">{editing ? 'تعديل السجل' : 'سجل جديد'}</span>
                <h3>{editing ? 'تعديل طريقة الدفع' : 'إضافة طريقة دفع'}</h3>
                <p>استخدم اسماً واضحاً ليسهل اختياره داخل نماذج الطلبات.</p>
              </div>
              <div className="ss-editor-field">
                <label htmlFor="payment-method-name">الاسم</label>
                <input id="payment-method-name" className="ss-input" value={name} onChange={(event) => setName(event.target.value)} placeholder="مثال: الدفع عند الاستلام" autoFocus disabled={saving} />
              </div>
              <div className="ss-editor-field"><label className="ss-checkbox-label"><input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} disabled={saving} /> نشط</label></div>
              <div className="ss-editor-actions">
                <Button variant="ghost" onClick={closeForm} disabled={saving}>إلغاء</Button>
                <Button type="submit" disabled={saving}>{saving ? 'جاري الحفظ...' : editing ? 'حفظ التعديل' : 'إضافة السجل'}</Button>
              </div>
            </form>
          )}

          <div className="ss-data-surface">
            {loading ? <LoadingState /> : filteredItems.length === 0 ? <EmptyState singular="طريقة دفع" onAdd={startAdd} hasSearch={Boolean(query.trim())} /> : (
              <div className="ss-table-scroll">
                <table className="ss-table">
                  <thead><tr><th>#</th><th>الاسم</th><th>الحالة</th><th className="ss-actions-column">الإجراءات</th></tr></thead>
                  <tbody>
                    {filteredItems.map((item, index) => (
                      <tr key={item.id}>
                        <td><span className="ss-row-number">{index + 1}</span></td>
                        <td><span className="ss-item-name">{item.name}</span></td>
                    <td><ActiveBadge isActive={item.isActive} /></td>
                        <td className="ss-actions-column">
                          <div className="ss-row-actions">
                            <button className="ss-icon-button ss-icon-edit" onClick={() => startEdit(item)} disabled={saving} aria-label={`تعديل ${item.name}`} title="تعديل"><EditIcon /></button>
                            <button className="ss-icon-button ss-icon-delete" onClick={() => void remove(item)} disabled={saving} aria-label={`حذف ${item.name}`} title="حذف"><TrashIcon /></button>
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
