import { useState, useEffect, useCallback } from 'react'
import DashboardLayout from '../../components/DashboardLayout/DashboardLayout'
import { toArabicNumerals } from '../../utils/arabicNumerals'
import { salesApi, type OrderListItem, type Order, type OrderStatus, type OrderType } from '../../lib/api'
import '../../styles/DashboardViews.css'
import './OrderManagement.css'

interface OrderManagementProps {
  navigate: (path: string) => void
}

export default function OrderManagement({ navigate }: OrderManagementProps) {
  const [orders, setOrders] = useState<OrderListItem[]>([])
  const [totalEntries, setTotalEntries] = useState(0)
  const [totalPages, setTotalPages] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<OrderStatus | ''>('')
  const [page, setPage] = useState(1)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const result = await salesApi.listOrders({ page, pageSize: 10, type: 'SALE', search: search.trim() || undefined, status: statusFilter || undefined })
      setOrders(result.items)
      setTotalEntries(result.total)
      setTotalPages(result.totalPages)
    } catch {
    } finally {
      setLoading(false)
    }
  }, [page, search, statusFilter])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const deleteOrder = async (orderId: string, orderNumber: string) => {
    if (!window.confirm(`هل أنت متأكد من حذف الطلب رقم «${orderNumber}»؟`)) return
    setSaving(true)
    try {
      await salesApi.deleteOrder(orderId)
      await loadData()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'تعذر حذف الطلب.')
    } finally {
      setSaving(false)
    }
  }

  const toggleExpand = (id: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <DashboardLayout navigate={navigate}>
      <div className="view-container">
        <div className="ss-page-header">
          <div>
            <p className="ss-page-kicker">المبيعات</p>
            <h1 className="ss-page-title">سجل الطلبات</h1>
            <p className="ss-page-sub">متابعة وإدارة الفواتير والطلبات المسجلة.</p>
          </div>
        </div>

        <div className="io-data-surface">
          <div className="io-module-heading">
            <h2>سجل فواتير وطلبات المبيعات</h2>
          </div>

          <div className="om-filter-bar">
            <input
              type="text"
              placeholder="بحث برقم الطلب أو اسم العميل أو الهاتف..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            />
            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value as OrderStatus | ''); setPage(1) }}
            >
              <option value="">كل الحالات</option>
              <option value="NEW">جديد</option>
              <option value="CONFIRMED">تم التأكيد</option>
              <option value="POSTPONED">مؤجل</option>
              <option value="CANCELLED">ملغي</option>
              <option value="NO_ANSWER">لم يرد</option>
              <option value="DELIVERED">تم التسليم</option>
              <option value="RETURNED">مرتجع</option>
              <option value="NOT_DELIVERED">لم يتم التوصيل</option>
              <option value="ON_THE_WAY">في الطريق</option>
              <option value="RETURNED_TO_WAREHOUSE">تم الإرجاع للمخزن</option>
            </select>
          </div>

          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '150px', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
              جاري التحميل...
            </div>
          ) : orders.length === 0 ? (
            <div className="io-empty-state">
              <h3>لا توجد طلبات مبيعات</h3>
              <p>سجل أول طلب مبيعات من خلال "اضافه مبيعات" في القائمة الجانبية.</p>
            </div>
          ) : (
            <>
              <div className="io-table-scroll om-table-scroll">
                <table className="io-table">
                  <thead>
                    <tr>
                      <th style={{ width: '30px' }}></th>
                      <th>رقم الفاتورة</th>
                      <th>العميل</th>
                      <th>الهاتف</th>
                      <th>المستودع</th>
                      <th>المجموع الفرعي</th>
                      <th>الشحن</th>
                      <th>الخصم</th>
                      <th>الصافي الفعلي</th>
                      <th>الحالة</th>
                      <th style={{ textAlign: 'center' }}>الإجراءات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((o) => (
                      <ExpandableRow
                        key={o.id}
                        order={o}
                        expanded={expandedRows.has(o.id)}
                        onToggle={() => toggleExpand(o.id)}
                        saving={saving}
                        onDelete={() => deleteOrder(o.id, o.orderNumber)}
                        navigate={navigate}
                      />
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
                    الصفحة {toArabicNumerals(page)} من {toArabicNumerals(totalPages)} ({toArabicNumerals(totalEntries)} طلب)
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
    </DashboardLayout>
  )
}

function ExpandableRow({
  order,
  expanded,
  onToggle,
  saving,
  onDelete,
  navigate,
}: {
  order: OrderListItem
  expanded: boolean
  onToggle: () => void
  saving: boolean
  onDelete: () => void
  navigate: (path: string) => void
}) {
  const STATUS_LABEL: Record<OrderStatus, string> = {
    NEW: 'جديد', CONFIRMED: 'مؤكد', POSTPONED: 'مؤجل', CANCELLED: 'ملغي',
    NO_ANSWER: 'لا يرد', DELIVERED: 'تم التسليم', RETURNED: 'مرتجع',
    NOT_DELIVERED: 'لم يُسلّم', ON_THE_WAY: 'في الطريق',
    RETURNED_TO_WAREHOUSE: 'رُجع للمخزن',
  }
  const TYPE_LABEL: Record<OrderType, string> = { SALE: 'بيع', RETURN: 'مرتجع', EXCHANGE: 'استبدال' }
  const money = (v: string | number) => toArabicNumerals(Number(v).toFixed(2))
  // The expanded panel shows the full order; fetch it once when the row opens.
  const [detail, setDetail] = useState<Order | null>(null)
  useEffect(() => {
    if (!expanded || detail) return
    let cancelled = false
    salesApi.getOrder(order.id).then((full) => {
      if (!cancelled) setDetail(full)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [expanded, detail, order.id])

  const statusIcon = expanded ? '▾' : '▸'
  const discountAmount = Number(order.orderPrice) * (Number(order.discountPercentage) / 100)

  // Status colours come from the themeable tokens so they adapt to dark mode.
  // These were hardcoded light-mode pairs (#e8f5e9 on #2e7d32 and friends) with
  // no dark counterpart, so every badge kept a pale background under dark-mode
  // text — the worst being POSTPONED at 2.49:1. The tokens already existed and
  // were already dark-aware; the badges simply were not using them.
  const statusStyle: React.CSSProperties = (() => {
    switch (order.status) {
      case 'CONFIRMED': return { background: 'var(--color-success-soft)', color: 'var(--color-success)' }
      case 'POSTPONED': return { background: 'var(--color-warning-soft)', color: 'var(--color-warning)' }
      case 'CANCELLED': return { background: 'var(--color-danger-soft)', color: 'var(--color-danger)' }
      case 'NO_ANSWER': return { background: 'var(--bg-secondary)', color: 'var(--text-secondary)' }
      case 'DELIVERED': return { background: 'var(--color-success-soft)', color: 'var(--color-success)' }
      case 'RETURNED': return { background: 'var(--color-danger-soft)', color: 'var(--color-danger)' }
      case 'NOT_DELIVERED': return { background: 'var(--color-warning-soft)', color: 'var(--color-warning)' }
      case 'ON_THE_WAY': return { background: 'var(--color-accent-soft)', color: 'var(--color-accent)' }
      case 'RETURNED_TO_WAREHOUSE': return { background: 'var(--bg-subtle)', color: 'var(--text-secondary)' }
      default: return { background: 'var(--bg-secondary)', color: 'var(--color-success)' }
    }
  })()

  return (
    <>
      <tr className="om-row" onClick={onToggle} style={{ cursor: 'pointer' }}>
        <td style={{ textAlign: 'center', fontSize: '0.7rem', userSelect: 'none' }}>{statusIcon}</td>
        <td><strong style={{ fontFamily: 'monospace' }}>{order.orderNumber}</strong></td>
        <td><span className="io-item-name">{order.customer.name}</span></td>
        <td><span>{toArabicNumerals(order.customer.phoneNumber1)}</span></td>
        <td><span>{order.warehouse?.name || '—'}</span></td>
        <td><span>{money(order.orderPrice)} ج.م</span></td>
        <td><span>{money(order.shippingCost)} ج.م</span></td>
        <td><span>{toArabicNumerals(String(order.discountPercentage))}٪</span></td>
        <td><strong>{money(order.orderActualPrice)} ج.م</strong></td>
        <td>
          <span className="io-related-badge" style={statusStyle}>{STATUS_LABEL[order.status]}</span>
          {order.hasShortage && (
            <span className="om-shortage-badge">⚠️ عجز مخزون</span>
          )}
        </td>
        <td style={{ textAlign: 'center' }} onClick={e => e.stopPropagation()}>
          <button className="ss-icon-button" style={{ background: 'var(--color-accent-soft)', color: 'var(--color-accent)' }} onClick={() => navigate(`/dashboard/orders/${order.id}/invoice`)} title="فاتورة" aria-label="فاتورة">فاتورة</button>
          {' '}
          <button className="ss-icon-button ss-icon-delete" onClick={onDelete} disabled={saving} title="حذف الطلب" aria-label="حذف الطلب">حذف</button>
        </td>
      </tr>
      {expanded && (
        <tr className="om-expanded-row">
          <td colSpan={11}>
            <div className="om-expanded-content">
              <div className="om-expanded-grid">
                <div className="om-expanded-section">
                  <h4>معلومات الطلب</h4>
                  <div><span>رقم الطلب:</span> {order.orderNumber}</div>
                  <div><span>تاريخ الإنشاء:</span> {new Date(order.createdAt).toLocaleDateString('ar-EG')}</div>
                  <div><span>النوع:</span> {TYPE_LABEL[order.type]}</div>
                  <div><span>الحالة:</span> {STATUS_LABEL[order.status]}</div>
                  <div><span>مصدر الطلب:</span> {order.orderSource?.name || '—'}</div>
                  <div><span>طريقة الدفع:</span> {order.paymentMethod?.name || '—'}</div>
                  {detail?.externalNumber && <div><span>رقم طلب المتجر:</span> <span dir="ltr">{detail.externalNumber}</span></div>}
                </div>
                <div className="om-expanded-section">
                  <h4>معلومات العميل</h4>
                  <div><span>الاسم:</span> {order.customer.name}</div>
                  <div><span>الهاتف الأساسي:</span> {toArabicNumerals(order.customer.phoneNumber1)}</div>
                  <div><span>المحافظة:</span> {order.shippingGovernorate?.name || '—'}</div>
                  <div><span>المدينة:</span> {order.city?.name || '—'}</div>
                  {detail?.detailedAddress && <div><span>العنوان:</span> {detail.detailedAddress}</div>}
                </div>
                <div className="om-expanded-section">
                  <h4>الشحن والتوصيل</h4>
                  <div><span>شركة الشحن:</span> {order.carrier?.name || '—'}</div>
                  <div><span>تكلفة الشحن:</span> {money(order.shippingCost)} ج.م</div>
                  <div><span>المستودع:</span> {order.warehouse?.name || '—'}</div>
                </div>
                <div className="om-expanded-section">
                  <h4>التسعير والخصم</h4>
                  <div><span>العملة:</span> {order.currencyCode || 'EGP'}</div>
                  <div><span>سعر الطلب:</span> {money(order.orderPrice)}</div>
                  <div><span>نسبة الخصم:</span> {toArabicNumerals(String(order.discountPercentage))}%</div>
                  {order.couponCode && <div><span>كوبون:</span> <strong dir="ltr">{order.couponCode}</strong></div>}
                  <div><span>قيمة الخصم:</span> {toArabicNumerals(discountAmount.toFixed(2))}</div>
                  <div><span>السعر الفعلي:</span> <strong>{money(order.orderActualPrice)}</strong></div>
                </div>
              </div>
              {detail?.notes && (
                <div className="om-expanded-section om-expanded-full">
                  <h4>ملاحظات</h4>
                  <div>{detail.notes}</div>
                </div>
              )}
              <div className="om-expanded-section om-expanded-full">
                <h4>الجدول الزمني</h4>
                <div><span>أُنشئ:</span> {new Date(order.createdAt).toLocaleString('ar-EG')}</div>
                {order.confirmedAt && <div><span>أُكد:</span> {new Date(order.confirmedAt).toLocaleString('ar-EG')}</div>}
                {detail?.shippedAt && <div><span>شُحن:</span> {new Date(detail.shippedAt).toLocaleString('ar-EG')}</div>}
                {order.deliveredAt && <div><span>سُلّم:</span> {new Date(order.deliveredAt).toLocaleString('ar-EG')}</div>}
                {detail?.cancelledAt && <div style={{ color: 'var(--color-danger)' }}><span>أُلغي:</span> {new Date(detail.cancelledAt).toLocaleString('ar-EG')}</div>}
                {detail?.productionBatch && <div><span>دفعة التصنيع:</span> {detail.productionBatch.batchNumber}</div>}
                {detail?.originalOrder && <div><span>الطلب الأصل:</span> {detail.originalOrder.orderNumber}</div>}
                {detail?.derivedOrders && detail.derivedOrders.length > 0 && (
                  <div><span>طلبات مشتقة:</span> {detail.derivedOrders.map((d) => `${d.orderNumber} (${TYPE_LABEL[d.type]})`).join('، ')}</div>
                )}
              </div>
              {order.status === 'CANCELLED' && detail?.cancelReason && (
                <div className="om-expanded-section om-expanded-full">
                  <h4>سبب الإلغاء</h4>
                  <div style={{ color: 'var(--color-danger)' }}>{detail.cancelReason.name}</div>
                </div>
              )}
              <div className="om-expanded-section om-expanded-full">
                <h4>المنتجات ({toArabicNumerals(detail?.items.length ?? order._count.items)})</h4>
                <table className="om-items-table">
                  <thead>
                    <tr>
                      <th>المنتج</th>
                      <th>الكمية</th>
                      <th>الكمية المؤكدة</th>
                      <th>سعر الوحدة</th>
                      <th>الإجمالي</th>
                      <th>الخصم</th>
                      <th>الصافي</th>
                      <th>حالة التصنيع</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail?.items.map((item: Order['items'][number]) => {
                      const gross = Number(item.unitPrice) * item.quantity;
                      const itemDiscount = item.discountType === 'PERCENTAGE'
                        ? (gross * Number(item.itemDiscountPercentage)) / 100
                        : Number(item.itemDiscountAmount);
                      const net = Math.max(0, gross - itemDiscount);
                      return (
                      <tr key={item.id}>
                        <td>{item.product.name}</td>
                        <td>{toArabicNumerals(String(item.quantity))}</td>
                        <td>{toArabicNumerals(String(item.confirmedQuantity))}</td>
                        <td>{money(item.unitPrice)}</td>
                        <td>{money(gross)}</td>
                        <td>{itemDiscount > 0 ? (item.discountType === 'PERCENTAGE' ? `${toArabicNumerals(String(item.itemDiscountPercentage))}%` : money(item.itemDiscountAmount)) : '—'}</td>
                        <td>{money(net)}</td>
                        <td>{item.needsManufacturing ? <span className="om-needs-mfg">يحتاج تصنيع</span> : <span className="om-available">متوفر</span>}</td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
