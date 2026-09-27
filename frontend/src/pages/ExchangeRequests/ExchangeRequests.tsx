import { useState, useEffect, useCallback, type FormEvent } from 'react'
import { toast } from "sonner";
import DashboardLayout from '../../components/DashboardLayout/DashboardLayout'
import { toArabicNumerals } from '../../utils/arabicNumerals'
import {
  salesApi,
  inventoryApi,
  catalogApi,
  type OrderListItem,
  type Warehouse,
  type ProductListItem,
} from '../../lib/api'
import '../../styles/DashboardViews.css'

const ORDER_STATUS_AR: Record<string, string> = {
  NEW: 'جديد', CONFIRMED: 'مؤكد', POSTPONED: 'مؤجل', CANCELLED: 'ملغي',
  NO_ANSWER: 'لا يرد', DELIVERED: 'تم التسليم', RETURNED: 'مرتجع',
  NOT_DELIVERED: 'لم يُسلّم', ON_THE_WAY: 'في الطريق',
  RETURNED_TO_WAREHOUSE: 'رُجع للمخزن',
};

const PAGE_SIZE = 10

interface ExchangeRequestsProps {
  navigate: (path: string) => void
}

export default function ExchangeRequests({ navigate }: ExchangeRequestsProps) {
  const [orders, setOrders] = useState<OrderListItem[]>([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [totalEntries, setTotalEntries] = useState(0)
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [products, setProducts] = useState<ProductListItem[]>([])

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [formOpen, setFormOpen] = useState(false)

  const [origOrderNum, setOrigOrderNum] = useState('')
  const [custName, setCustName] = useState('')
  const [custPhone, setCustPhone] = useState('')
  const [whId, setWhId] = useState('')
  const [discountPercent, setDiscountPercent] = useState('0')
  const [notes, setNotes] = useState('')
  const [items, setItems] = useState<{ productId: string; quantity: number; unitPrice: number }[]>([])

  const loadData = useCallback(async (currentPage = page) => {
    setLoading(true)
    try {
      const [oPage, wList, prPage] = await Promise.all([
        salesApi.listOrders({ type: 'EXCHANGE', page: currentPage, pageSize: PAGE_SIZE }).catch(() => ({ items: [] as OrderListItem[], page: 1, pageSize: PAGE_SIZE, total: 0, totalPages: 0 })),
        inventoryApi.listWarehouses().catch(() => [] as Warehouse[]),
        catalogApi.listProducts({ isActive: true, pageSize: 200 }).catch(() => ({ items: [] as ProductListItem[] })),
      ])
      setOrders(oPage.items)
      setTotalPages(oPage.totalPages)
      setTotalEntries(oPage.total)
      setWarehouses(wList)
      setProducts(prPage.items)
    } catch {
      // Swallowed
    } finally {
      setLoading(false)
    }
  }, [page])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const goToPage = (next: number) => {
    // Only state changes: `loadData` depends on `page`, so the effect refetches once.
    setPage(next)
  }

  const startAdd = () => {
    setOrigOrderNum('')
    setCustName('')
    setCustPhone('')
    setWhId(warehouses[0]?.id || '')
    setDiscountPercent('0')
    setNotes('')
    setItems([{ productId: products[0]?.id || '', quantity: 1, unitPrice: Number(products[0]?.price || 0) }])
    setFormOpen(true)
  }

  const handleItemAdd = () => {
    if (products.length === 0) return
    setItems([...items, { productId: products[0].id, quantity: 1, unitPrice: Number(products[0].price) }])
  }

  const handleItemRemove = (idx: number) => {
    setItems(items.filter((_, i) => i !== idx))
  }

  const handleItemUpdate = (idx: number, key: string, val: any) => {
    const updated = [...items]
    updated[idx] = { ...updated[idx], [key]: val }
    if (key === 'productId') {
      const price = Number(products.find((p) => p.id === val)?.price || 0)
      updated[idx].unitPrice = price
    }
    setItems(updated)
  }

  const closeForm = () => {
    setFormOpen(false)
    setItems([])
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!custName.trim() || !custPhone.trim() || items.length === 0) {
      toast.error('يرجى إدخال اسم العميل وهاتفه وإضافة عنصر واحد على الأقل.')
      return
    }

    setSaving(true)
    try {
      let origOrderId: string | undefined
      if (origOrderNum.trim()) {
        try {
          const found = await salesApi.listOrders({ search: origOrderNum.trim(), pageSize: 1 })
          origOrderId = found.items[0]?.id
        } catch {
          toast.error('الطلب الأصلي المشار إليه غير موجود، سيتم تجاهل الربط.')
        }
      }

      const { customer } = await salesApi.findOrCreateCustomer({
        name: custName.trim(),
        phoneNumber1: custPhone.trim(),
      })

      await salesApi.createOrder({
        type: 'EXCHANGE',
        originalOrderId: origOrderId ?? null,
        customerId: customer.id,
        shippingCost: 0,
        discountPercentage: Number(discountPercent),
        warehouseId: whId || null,
        notes: notes.trim(),
        items: items.map((i) => ({
          productId: i.productId,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          discountType: 'PERCENTAGE' as const,
        })),
      })
      toast.success('تم تسجيل طلب استبدال جديد بنجاح.')
      closeForm()
      await loadData()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'تعذر حفظ طلب الاستبدال.')
    } finally {
      setSaving(false)
    }
  }

  const deleteOrder = async (orderId: string, orderNumber: string) => {
    if (!window.confirm(`هل أنت متأكد من حذف طلب الاستبدال رقم «${orderNumber}»؟`)) return
    setSaving(true)
    try {
      await salesApi.deleteOrder(orderId)
      toast.error('تم الحذف بنجاح.')
      await loadData()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'تعذر حذف السجل.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <DashboardLayout navigate={navigate}>
      <div className="view-container">
        <div className="view-header" style={{ marginBottom: '1.5rem' }}>
          <div>
            <h1 className="view-header-title">طلبات الاستبدال</h1>
            <p className="view-header-subtitle">إدارة طلبات استبدال السلع ومتابعة الأصناف المستبدلة.</p>
          </div>
          <div className="filter-wrapper" style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="io-button io-button-primary" onClick={startAdd} disabled={saving}>+ استبدال جديد</button>
          </div>
        </div>

        {formOpen && (
          <form className="io-multi-editor" onSubmit={submit} style={{ margin: '0 0 1.5rem', background: 'var(--bg-secondary)', padding: '1rem', borderRadius: '12px' }}>
            <div className="io-multi-editor-full">
              <h3>تسجيل طلب استبدال</h3>
              <p style={{ fontSize: '0.8rem', color: 'var(--ss-ink-soft)' }}>قم بملء تفاصيل الاستبدال لاستبدال الأصناف التالفة أو غير المطابقة.</p>
            </div>

            <div className="io-editor-field">
              <label>رقم الطلب الأصلي المرتبط (إن وجد)</label>
              <input className="pb-input" value={origOrderNum} onChange={(e) => setOrigOrderNum(e.target.value)} placeholder="مثال: SO-00000001" disabled={saving} />
            </div>

            <div className="io-editor-field">
              <label>اسم العميل *</label>
              <input className="pb-input" value={custName} onChange={(e) => setCustName(e.target.value)} placeholder="الاسم الكامل" disabled={saving} />
            </div>

            <div className="io-editor-field">
              <label>رقم هاتف العميل *</label>
              <input className="pb-input" value={custPhone} onChange={(e) => setCustPhone(e.target.value)} placeholder="01xxxxxxxxx" disabled={saving} />
            </div>

            <div className="io-editor-field">
              <label>مستودع الصرف</label>
              <select className="pb-input" value={whId} onChange={(e) => setWhId(e.target.value)} disabled={saving}>
                {warehouses.map((w) => (
                  <option value={w.id} key={w.id}>{w.name}</option>
                ))}
              </select>
            </div>

            <div className="io-editor-field">
              <label>خصم إضافي (%)</label>
              <input type="number" className="pb-input" value={discountPercent} onChange={(e) => setDiscountPercent(e.target.value)} disabled={saving} />
            </div>

            <div className="io-editor-field io-multi-editor-full">
              <label>ملاحظات الاستبدال</label>
              <input className="pb-input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="ملاحظات حول الاستبدال..." disabled={saving} />
            </div>

            <div className="io-multi-editor-full io-nested-form-section">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <strong>الأصناف المستبدلة *</strong>
                <button type="button" className="io-button io-button-secondary" onClick={handleItemAdd} disabled={saving || products.length === 0}>+ إضافة منتج</button>
              </div>
              {items.map((it, idx) => (
                <div className="io-nested-row" key={idx}>
                  <div>
                    <label>المنتج</label>
                    <select className="pb-input" value={it.productId} onChange={(e) => handleItemUpdate(idx, 'productId', e.target.value)} disabled={saving}>
                      {products.map((p) => (
                        <option value={p.id} key={p.id}>{p.name} ({p.price} ج.م)</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label>الكمية</label>
                    <input type="number" className="pb-input" value={it.quantity} onChange={(e) => handleItemUpdate(idx, 'quantity', Number(e.target.value))} disabled={saving} />
                  </div>
                  <div>
                    <label>سعر الوحدة</label>
                    <input type="number" className="pb-input" value={it.unitPrice} disabled={true} />
                  </div>
                  <div className="io-nested-row-btn">
                    <button type="button" className="io-button io-button-danger" onClick={() => handleItemRemove(idx)} disabled={saving}>حذف</button>
                  </div>
                </div>
              ))}
            </div>

            <div className="io-multi-editor-full" style={{ display: 'flex', justifyContent: 'flex-start', gap: '0.5rem', marginTop: '0.8rem' }}>
              <button type="button" className="io-button io-button-ghost" onClick={closeForm} disabled={saving}>إلغاء</button>
              <button type="submit" className="io-button io-button-primary" disabled={saving}>{saving ? 'جاري الحفظ...' : 'تسجيل الاستبدال'}</button>
            </div>
          </form>
        )}

        <div className="io-data-surface" style={{ marginTop: '1.5rem' }}>
          <div style={{ padding: '0.75rem 1rem', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong style={{ fontSize: '0.85rem', color: 'var(--ss-ink)' }}>سجل طلبات الاستبدال</strong>
          </div>

          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '150px', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>جاري التحميل...</div>
          ) : orders.length === 0 ? (
            <div className="io-empty-state">
              <h3>لا توجد طلبات استبدال</h3>
              <p>سجل أول طلب استبدال بالضغط على زر "استبدال جديد" أعلاه.</p>
            </div>
          ) : (
            <div className="io-table-scroll">
              <table className="io-table">
                <thead>
                  <tr>
                    <th>رقم السند</th>
                    <th>العميل</th>
                    <th>الهاتف</th>
                    <th>المخزن</th>
                    <th>الصافي المالي</th><th>شركة الشحن</th><th>المدينة</th><th>التاريخ</th><th>الحالة</th>
                    <th style={{ textAlign: 'center' }}>الإجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o) => (
                    <tr key={o.id}>
                      <td><strong style={{ fontFamily: 'monospace' }}>{o.orderNumber}</strong></td>
                      <td><span className="io-item-name">{o.customer.name}</span></td>
                      <td><span>{toArabicNumerals(o.customer.phoneNumber1)}</span></td>
                      <td><span>{o.warehouse?.name || '—'}</span></td>
                      <td><strong style={{ color: 'var(--ss-terracotta)' }}>{toArabicNumerals(Number(o.orderActualPrice).toFixed(2))} ج.م</strong></td>
                      <td><span>{o.carrier?.name ?? '—'}</span></td>
                      <td><span>{o.city?.name ?? o.shippingGovernorate?.name ?? '—'}</span></td>
                      <td><span>{new Date(o.createdAt).toLocaleDateString('ar-EG')}</span></td>
                      <td>
                        <span className="io-related-badge">{ORDER_STATUS_AR[o.status] ?? o.status}</span>
                        {o.hasShortage && (
                          <span className="io-shortage-badge" style={{
                            backgroundColor: 'var(--bg-secondary)', color: 'var(--color-danger)', border: '1px solid #cccccc',
                            borderRadius: '4px', padding: '2px 6px', fontSize: '0.8rem', fontWeight: 'bold',
                            marginRight: '6px', display: 'inline-flex', alignItems: 'center', gap: '4px'
                          }}>⚠️ عجز مخزون</span>
                        )}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <button className="forgot-btn" style={{ fontSize: '0.8rem', textDecoration: 'none', color: 'var(--ss-terracotta)' }} onClick={() => void deleteOrder(o.id, o.orderNumber)} disabled={saving}>حذف</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!loading && totalPages > 1 && (
            <div className="io-pager">
              <button className="io-button io-button-secondary" onClick={() => goToPage(page - 1)} disabled={page <= 1}>
                السابق
              </button>
              <span className="io-pager-status">
                صفحة {toArabicNumerals(page)} من {toArabicNumerals(totalPages)} ({toArabicNumerals(totalEntries)})
              </span>
              <button className="io-button io-button-secondary" onClick={() => goToPage(page + 1)} disabled={page >= totalPages}>
                التالي
              </button>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  )
}
