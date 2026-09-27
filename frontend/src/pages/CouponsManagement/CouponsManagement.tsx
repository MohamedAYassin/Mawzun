import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import DashboardLayout from '../../components/DashboardLayout/DashboardLayout'
import { toArabicNumerals } from '../../utils/arabicNumerals'
import { salesApi, type Coupon } from '../../lib/api'
import { ModuleHeading, ModuleActions, StatusBanner, ListToolbar, LoadingState, EmptyState, EditorHeader, EditorActions, RowActions, ActiveBadge, type Notice } from '../shared/ManagementUi'
import '../SystemSettings/SystemSettings.css'

interface CouponsManagementProps {
  navigate: (path: string) => void
}

const fmtMoney = (n: number) => n.toLocaleString('ar-EG', { maximumFractionDigits: 2 })

function CouponsTab() {
  const [items, setItems] = useState<Coupon[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Coupon | null>(null)
  const [code, setCode] = useState('')
  const [discountType, setDiscountType] = useState<'PERCENTAGE' | 'FIXED'>('PERCENTAGE')
  const [value, setValue] = useState('')
  const [minOrderTotal, setMinOrderTotal] = useState('')
  const [maxRedemptions, setMaxRedemptions] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [lastLoaded, setLastLoaded] = useState<Date | null>(null)

  const load = useCallback(async (showLoader = true) => {
    if (showLoader) setLoading(true)
    try {
      const page = await salesApi.listCoupons({ pageSize: 200 })
      setItems(page.items)
      setLastLoaded(new Date())
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'تعذر تحميل رموز الخصم.' })
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load])

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter((item) => item.code.toLowerCase().includes(q))
  }, [items, query])

  const startAdd = () => {
    setEditing(null); setCode(''); setDiscountType('PERCENTAGE'); setValue(''); setMinOrderTotal(''); setMaxRedemptions(''); setExpiresAt(''); setIsActive(true); setFormOpen(true); setNotice(null)
  }
  const startEdit = (item: Coupon) => {
    setEditing(item); setCode(item.code); setDiscountType(item.discountType); setValue(String(item.value))
    setMinOrderTotal(item.minOrderTotal === null ? '' : String(item.minOrderTotal))
    setMaxRedemptions(item.maxRedemptions === null ? '' : String(item.maxRedemptions))
    setExpiresAt(item.expiresAt ? item.expiresAt.slice(0, 10) : '')
    setIsActive(item.isActive); setFormOpen(true); setNotice(null)
  }
  const closeForm = () => {
    setFormOpen(false); setEditing(null); setCode(''); setDiscountType('PERCENTAGE'); setValue(''); setMinOrderTotal(''); setMaxRedemptions(''); setExpiresAt(''); setIsActive(true)
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!code.trim()) { setNotice({ type: 'error', text: 'يرجى إدخال رمز الخصم.' }); return }
    const numValue = Number(value)
    if (!Number.isFinite(numValue) || numValue <= 0) { setNotice({ type: 'error', text: 'أدخل قيمة خصم صالحة.' }); return }
    if (discountType === 'PERCENTAGE' && numValue > 100) { setNotice({ type: 'error', text: 'النسبة لا تتجاوز 100%.' }); return }

    const payload = {
      code: code.trim(),
      discountType,
      value: numValue,
      minOrderTotal: minOrderTotal.trim() === '' ? null : Number(minOrderTotal),
      maxRedemptions: maxRedemptions.trim() === '' ? null : Number(maxRedemptions),
      expiresAt: expiresAt.trim() === '' ? null : new Date(expiresAt.trim() + 'T23:59:59').toISOString(),
      isActive,
    }
    setSaving(true); setNotice(null)
    try {
      if (editing) {
        await salesApi.updateCoupon(editing.id, payload)
        setNotice({ type: 'success', text: 'تم تحديث رمز الخصم.' })
      } else {
        await salesApi.createCoupon(payload)
        setNotice({ type: 'success', text: 'تم إنشاء رمز الخصم.' })
      }
      closeForm(); await load(false)
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'تعذر حفظ رمز الخصم.' })
    } finally { setSaving(false) }
  }

  const remove = async (item: Coupon) => {
    if (!window.confirm(`حذف رمز الخصم «${item.code}»؟ الطلبات القديمة تحتفظ بالخصم.`)) return
    setSaving(true); setNotice(null)
    try {
      await salesApi.deleteCoupon(item.id)
      setNotice({ type: 'success', text: 'تم حذف رمز الخصم.' })
      await load(false)
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'تعذر حذف رمز الخصم.' })
    } finally { setSaving(false) }
  }

  const describe = (c: Coupon) =>
    c.discountType === 'PERCENTAGE' ? `${Number(c.value)}%` : `${fmtMoney(Number(c.value))} ج`

  return { items, filteredItems, query, setQuery, loading, saving, formOpen, editing, code, setCode, discountType, setDiscountType, value, setValue, minOrderTotal, setMinOrderTotal, maxRedemptions, setMaxRedemptions, expiresAt, setExpiresAt, isActive, setIsActive, notice, lastLoaded, load, startAdd, startEdit, closeForm, submit, remove, describe }
}

function CouponsView() {
  const t = CouponsTab()
  return (
    <section className="ss-module animate-fade-in">
      <ModuleHeading icon={<span>🎟️</span>} eyebrow="المبيعات" title="رموز الخصم" subtitle="أكواد خصم يقدّمها العملاء عند إنشاء الطلب — نسبة مئوية أو مبلغ ثابت، مع حد أدنى للطلب وعدد استخدامات." />
      <ModuleActions count={t.items.length} countLabel="رمز" onRefresh={() => void t.load()} loading={t.loading} saving={t.saving} onAdd={t.startAdd} addLabel="إضافة رمز" />
      <StatusBanner notice={t.notice} />
      <ListToolbar query={t.query} setQuery={t.setQuery} placeholder="ابحث برمز الخصم..." lastLoaded={t.lastLoaded} />
      {t.formOpen && (
        <form className="ss-multi-editor" onSubmit={t.submit}>
          <EditorHeader editing={!!t.editing} singular="رمز الخصم" />
          <div className="ss-editor-field">
            <label htmlFor="coupon-code">الرمز</label>
            <input id="coupon-code" className="ss-input" value={t.code} onChange={(e) => t.setCode(e.target.value.toUpperCase())} placeholder="SUMMER10" dir="ltr" autoFocus disabled={t.saving} />
          </div>
          <div className="ss-editor-field">
            <label htmlFor="coupon-type">النوع</label>
            <select id="coupon-type" className="ss-input" value={t.discountType} onChange={(e) => t.setDiscountType(e.target.value as 'PERCENTAGE' | 'FIXED')} disabled={t.saving}>
              <option value="PERCENTAGE">نسبة مئوية %</option>
              <option value="FIXED">مبلغ ثابت</option>
            </select>
          </div>
          <div className="ss-editor-field">
            <label htmlFor="coupon-value">{t.discountType === 'PERCENTAGE' ? 'النسبة (0-100)' : 'المبلغ'}</label>
            <input id="coupon-value" className="ss-input" type="number" min="0" step="0.01" value={t.value} onChange={(e) => t.setValue(e.target.value)} disabled={t.saving} />
          </div>
          <div className="ss-editor-field">
            <label htmlFor="coupon-min">الحد الأدنى للطلب (اختياري)</label>
            <input id="coupon-min" className="ss-input" type="number" min="0" value={t.minOrderTotal} onChange={(e) => t.setMinOrderTotal(e.target.value)} disabled={t.saving} />
          </div>
          <div className="ss-editor-field">
            <label htmlFor="coupon-max">أقصى عدد استخدامات (اختياري)</label>
            <input id="coupon-max" className="ss-input" type="number" min="1" value={t.maxRedemptions} onChange={(e) => t.setMaxRedemptions(e.target.value)} disabled={t.saving} />
          </div>
          <div className="ss-editor-field">
            <label htmlFor="coupon-expiry">تاريخ الانتهاء (اختياري)</label>
            <input id="coupon-expiry" className="ss-input" type="date" value={t.expiresAt} onChange={(e) => t.setExpiresAt(e.target.value)} disabled={t.saving} />
          </div>
          <div className="ss-editor-field ss-multi-editor-full">
            <label className="ss-checkbox-label">
              <input type="checkbox" checked={t.isActive} onChange={(e) => t.setIsActive(e.target.checked)} disabled={t.saving} />
              <span>مفعّل</span>
            </label>
          </div>
          <EditorActions closeForm={t.closeForm} saving={t.saving} editing={!!t.editing} />
        </form>
      )}
      <div className="ss-data-surface">
        {t.loading ? <LoadingState /> : t.filteredItems.length === 0 ? <EmptyState hasSearch={Boolean(t.query.trim())} /> : (
          <div className="ss-table-scroll">
            <table className="ss-table">
              <thead><tr><th>#</th><th>الرمز</th><th>الخصم</th><th>الحد الأدنى</th><th>الاستخدام</th><th>الطلبات</th><th>الانتهاء</th><th>الحالة</th><th className="ss-actions-column">الإجراءات</th></tr></thead>
              <tbody>
                {t.filteredItems.map((item, index) => (
                  <tr key={item.id}>
                    <td><span className="ss-row-number">{index + 1}</span></td>
                    <td><span className="ss-item-name" dir="ltr">{item.code}</span></td>
                    <td><span className="ss-related-badge">{t.describe(item)}</span></td>
                    <td>{item.minOrderTotal === null ? '—' : fmtMoney(Number(item.minOrderTotal))}</td>
                    <td>{item.redemptionCount}{item.maxRedemptions !== null ? ` / ${item.maxRedemptions}` : ''}</td>
                    <td>{toArabicNumerals(String(item._count?.orders ?? 0))}</td>
                    <td>{item.expiresAt ? new Date(item.expiresAt).toLocaleDateString('ar-EG') : '—'}</td>
                    <td><ActiveBadge isActive={item.isActive} /></td>
                    <RowActions onEdit={() => t.startEdit(item)} onDelete={() => void t.remove(item)} saving={t.saving} name={item.code} />
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

export default function CouponsManagement({ navigate }: CouponsManagementProps) {
  return (
    <DashboardLayout navigate={navigate}>
      <div className="view-container">
        <CouponsView />
      </div>
    </DashboardLayout>
  )
}
