import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import DashboardLayout from '../../components/DashboardLayout/DashboardLayout'
import { ActiveBadge } from '../shared/ManagementUi'
import { salesApi, type OrderConfigEntry } from '../../lib/api'
import '../SystemSettings/SystemSettings.css'

interface OrderSourcesManagementProps {
  navigate: (path: string) => void
  embedded?: boolean
}

type Notice = {
  type: 'success' | 'error' | 'info'
  text: string
}

interface NamedEntity {
  id: string
  name: string
  isActive: boolean
}

interface LookupConfig<T extends NamedEntity> {
  title: string
  description: string
  singular: string
  plural: string
  placeholder: string
  icon: ReactNode
  getAll: () => Promise<T[]>
  create: (input: { name: string; isActive: boolean }) => Promise<T>
  update: (id: string, input: { name: string; isActive: boolean }) => Promise<unknown>
  remove: (id: string) => Promise<void>
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
const GlobeIcon = () => <Icon><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></Icon>

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

function LookupTab<T extends NamedEntity>({ config }: { config: LookupConfig<T> }) {
  const [items, setItems] = useState<T[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<T | null>(null)
  const [name, setName] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [lastLoaded, setLastLoaded] = useState<Date | null>(null)

  const load = useCallback(async (showLoader = true) => {
    if (showLoader) setLoading(true)
    try {
      const result = await config.getAll()
      setItems(result)
      setLastLoaded(new Date())
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'تعذر تحميل البيانات.' })
    } finally {
      setLoading(false)
    }
  }, [config])

  useEffect(() => {
    void load()
  }, [load])

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    if (!normalizedQuery) return items
    return items.filter((item) => item.name.toLocaleLowerCase().includes(normalizedQuery))
  }, [items, query])

  const startAdd = () => {
    setEditing(null)
    setName('')
    setIsActive(true)
    setFormOpen(true)
  }

  const startEdit = (item: T) => {
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
      setNotice({ type: 'error', text: `يرجى إدخال اسم ${config.singular}.` })
      return
    }

    setSaving(true)
    setNotice(null)
    try {
      if (editing) {
        await config.update(editing.id, { name: cleanName, isActive })
        setNotice({ type: 'success', text: `تم تحديث ${config.singular} بنجاح.` })
      } else {
        await config.create({ name: cleanName, isActive })
        setNotice({ type: 'success', text: `تمت إضافة ${config.singular} بنجاح.` })
      }
      closeForm()
      await load(false)
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'تعذر حفظ البيانات.' })
    } finally {
      setSaving(false)
    }
  }

  const remove = async (item: T) => {
    if (!window.confirm(`هل أنت متأكد من حذف ${config.singular} «${item.name}»؟`)) return
    setSaving(true)
    setNotice(null)
    try {
      await config.remove(item.id)
      setNotice({ type: 'success', text: `تم حذف ${config.singular} بنجاح.` })
      if (editing?.id === item.id) closeForm()
      await load(false)
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'تعذر حذف البيانات.' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="ss-module animate-fade-in">
      <div className="ss-module-heading">
        <div className="ss-module-icon">{config.icon}</div>
        <div>
          <p className="ss-eyebrow">بيانات مرجعية</p>
          <h2>{config.title}</h2>
          <p>{config.description}</p>
        </div>
      </div>

      <div className="ss-module-actions">
        <span className="ss-count-chip"><strong>{items.length}</strong> {config.plural}</span>
        <Button variant="ghost" onClick={() => void load()} disabled={loading || saving}><RefreshIcon /> تحديث</Button>
        <Button onClick={startAdd} disabled={saving}><PlusIcon /> إضافة {config.singular}</Button>
      </div>

      <StatusBanner notice={notice} />

      <div className="ss-list-toolbar">
        <label className="ss-search">
          <SearchIcon />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`ابحث في ${config.plural}...`} aria-label={`البحث في ${config.plural}`} />
        </label>
        <span className="ss-last-loaded">{lastLoaded ? `آخر تحديث ${lastLoaded.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}` : 'جاري تجهيز القائمة'}</span>
      </div>

      {formOpen && (
        <form className="ss-editor" onSubmit={submit}>
          <div className="ss-editor-copy">
            <span className="ss-editor-kicker">{editing ? 'تعديل السجل' : 'سجل جديد'}</span>
            <h3>{editing ? `تعديل ${config.singular}` : `إضافة ${config.singular}`}</h3>
            <p>استخدم اسماً واضحاً ليسهل اختياره داخل نماذج الطلبات.</p>
          </div>
          <div className="ss-editor-field">
            <label htmlFor={`${config.singular}-name`}>الاسم</label>
            <input id={`${config.singular}-name`} className="ss-input" value={name} onChange={(event) => setName(event.target.value)} placeholder={config.placeholder} autoFocus disabled={saving} />
          </div>
              <div className="ss-editor-field"><label className="ss-checkbox-label"><input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} disabled={saving} /> نشط</label></div>
          <div className="ss-editor-actions">
            <Button variant="ghost" onClick={closeForm} disabled={saving}>إلغاء</Button>
            <Button type="submit" disabled={saving}>{saving ? 'جاري الحفظ...' : editing ? 'حفظ التعديل' : 'إضافة السجل'}</Button>
          </div>
        </form>
      )}

      <div className="ss-data-surface">
        {loading ? <LoadingState /> : filteredItems.length === 0 ? <EmptyState singular={config.singular} onAdd={startAdd} hasSearch={Boolean(query.trim())} /> : (
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
  )
}

const orderSourceConfig: LookupConfig<OrderConfigEntry> = {
  title: 'مصادر الطلبات',
  description: 'القنوات التي تصل منها الطلبات إلى فريق المبيعات.',
  singular: 'مصدر طلب',
  plural: 'مصادر طلبات',
  placeholder: 'مثال: فيسبوك أو الموقع الإلكتروني',
  icon: <GlobeIcon />,
  getAll: () => salesApi.listOrderSources(),
  create: (input) => salesApi.createOrderSource(input),
  update: (id, input) => salesApi.updateOrderSource(id, input),
  remove: (id) => salesApi.deleteOrderSource(id),
}

export default function OrderSourcesManagement({ navigate, embedded = false }: OrderSourcesManagementProps) {
  const content = (
    <div className="view-container">
      <LookupTab config={orderSourceConfig} />
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
