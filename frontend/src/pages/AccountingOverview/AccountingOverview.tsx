import { useState, useEffect, useCallback } from 'react'
import DashboardLayout from '../../components/DashboardLayout/DashboardLayout'
import { toArabicNumerals } from '../../utils/arabicNumerals'
import { reportsApi, salesApi, type OrdersOverview, type OrderListItem, type OrderType, type OrderStatus } from '../../lib/api'
import '../../styles/DashboardViews.css'
import './AccountingOverview.css'

interface AccountingOverviewProps {
  navigate: (path: string) => void
}

export default function AccountingOverview({ navigate }: AccountingOverviewProps) {
  const [data, setData] = useState<OrdersOverview | null>(null)
  const [entries, setEntries] = useState<OrderListItem[]>([])
  const [totalEntries, setTotalEntries] = useState(0)
  const [totalPages, setTotalPages] = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  const TYPE_LABEL: Record<OrderType, string> = {
    SALE: 'بيع', RETURN: 'مرتجع', EXCHANGE: 'استبدال',
  }
  const STATUS_LABEL: Record<OrderStatus, string> = {
    NEW: 'جديد', CONFIRMED: 'مؤكد', POSTPONED: 'مؤجل', CANCELLED: 'ملغي',
    NO_ANSWER: 'لا يرد', DELIVERED: 'تم التسليم', RETURNED: 'مرتجع',
    NOT_DELIVERED: 'لم يُسلّم', ON_THE_WAY: 'في الطريق',
    RETURNED_TO_WAREHOUSE: 'رُجع للمخزن',
  }

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      // Gross/returns/net are the overview aggregates; the ledger below is
      // the orders list, which is what the old per-row payload was built from.
      const [totals, orders] = await Promise.all([
        reportsApi.ordersOverview(),
        salesApi.listOrders({ page, pageSize: 10, search: search.trim() || undefined }),
      ])
      setData(totals)
      setEntries(orders.items)
      setTotalEntries(orders.total)
      setTotalPages(orders.totalPages)
    } catch {
      // Swallowed
    } finally {
      setLoading(false)
    }
  }, [page, search])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const d = data ?? { orderCount: 0, totalAmount: 0, totalQuantity: 0, averageOrderPrice: 0, deliveredCount: 0, totalReturnedAmount: 0, netRevenue: 0 }

  return (
    <DashboardLayout navigate={navigate}>
      <div className="view-container">
        <div className="view-header" style={{ marginBottom: '1.5rem' }}>
          <div>
            <h1 className="view-header-title">الحسابات والتقارير المالية</h1>
            <p className="view-header-subtitle">ملخصات قائمة الدخل والميزانية وتفاصيل العمليات المالية المسجلة على النظام.</p>
          </div>
        </div>

        <div className="metrics-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
          <div className="metric-card" style={{ display: 'flex', flexDirection: 'column', padding: '1rem', background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '10px' }}>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>إجمالي المبيعات الإجمالية (Gross)</span>
            <span style={{ fontSize: '1.35rem', fontWeight: 700, color: 'var(--color-success)' }}>
              {toArabicNumerals((d.totalAmount ?? 0).toFixed(2))} ج.م
            </span>
          </div>
          <div className="metric-card" style={{ display: 'flex', flexDirection: 'column', padding: '1rem', background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '10px' }}>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>إجمالي قيمة المرتجعات (Loss)</span>
            <span style={{ fontSize: '1.35rem', fontWeight: 700, color: 'var(--color-danger)' }}>
              {toArabicNumerals((d.totalReturnedAmount ?? 0).toFixed(2))} ج.م
            </span>
          </div>
          <div className="metric-card" style={{ display: 'flex', flexDirection: 'column', padding: '1rem', background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '10px' }}>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>صافي الأرباح التشغيلية (Net)</span>
            <span style={{ fontSize: '1.35rem', fontWeight: 700, color: 'var(--color-success)' }}>
              {toArabicNumerals((d.netRevenue ?? 0).toFixed(2))} ج.م
            </span>
          </div>
          <div className="metric-card" style={{ display: 'flex', flexDirection: 'column', padding: '1rem', background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '10px' }}>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>الطلبات المُسلَّمة (Delivered)</span>
            <span style={{ fontSize: '1.35rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              {toArabicNumerals(d.deliveredCount ?? 0)}
              <span style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-muted)' }}> من {toArabicNumerals(d.orderCount ?? 0)} طلب</span>
            </span>
          </div>
        </div>

        <div className="io-data-surface" style={{ marginTop: '1rem' }}>
          <div style={{ padding: '0.75rem 1rem', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)' }}>
            <strong style={{ fontSize: '0.85rem', color: 'var(--text-primary)' }}>دفتر الأستاذ المالي</strong>
          </div>

          <div className="ao-filter-bar">
            <input
              type="text"
              placeholder="بحث برقم الفاتورة أو اسم العميل..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            />
          </div>

          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '150px', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
              جاري التحميل...
            </div>
          ) : entries.length === 0 ? (
            <div className="io-empty-state">
              <h3>لا توجد نتائج</h3>
              <p>لم يتم العثور على حركات تطابق معايير البحث.</p>
            </div>
          ) : (
            <>
              <div className="io-table-scroll ao-table-scroll">
                <table className="io-table">
                  <thead>
                    <tr>
                      <th>تاريخ الحركة</th>
                      <th>الحالة التشغيلية</th>
                      <th>رقم السند/الفاتورة</th>
                      <th>نوع الحركة</th>
                      <th>المستفيد/العميل</th>
                      <th>مصاريف الشحن</th>
                      <th>الخصم المطبق</th>
                      <th>صافي القيمة المحصلة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((o) => (
                      <tr key={o.id}>
                        <td><span>{new Date(o.createdAt).toLocaleDateString('ar-EG')}</span></td>
                        <td>
                          <span>{STATUS_LABEL[o.status]}</span>
                          {o.hasShortage && (
                            <span style={{ display: 'inline-block', backgroundColor: 'var(--color-danger-soft)', color: 'var(--color-danger)', borderRadius: 4, padding: '1px 6px', fontSize: '0.7rem', fontWeight: 600, marginRight: 4, verticalAlign: 'middle' }}>عجز</span>
                          )}
                        </td>
                        <td><strong style={{ fontFamily: 'monospace' }}>{o.orderNumber}</strong></td>
                        <td>
                          <span style={{ background: 'var(--bg-secondary)', color: o.type === 'RETURN' ? '#e6a23c' : '#67c23a', padding: '2px 6px', borderRadius: '4px', fontSize: '0.85rem' }}>
                            {TYPE_LABEL[o.type]}
                          </span>
                        </td>
                        <td><span>{o.customer.name}</span></td>
                        <td><span>{toArabicNumerals(Number(o.shippingCost).toFixed(2))} ج.م</span></td>
                        <td><span>{toArabicNumerals(Number(o.discountPercentage))}٪</span></td>
                        <td>
                          <strong style={{ color: o.type === 'RETURN' ? 'var(--color-danger)' : 'var(--color-success)' }}>
                            {toArabicNumerals(Number(o.orderActualPrice).toFixed(2))} ج.م
                          </strong>
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
                    الصفحة {toArabicNumerals(page)} من {toArabicNumerals(totalPages)} ({toArabicNumerals(totalEntries)} سجل)
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
