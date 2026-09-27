import { useCallback, useEffect, useMemo, useState } from 'react'
import DashboardLayout from '../../components/DashboardLayout/DashboardLayout'
import { DataGridToolbar, useDataGrid } from '../../components/DataGrid/DataGrid'
import { salesApi, type OrderListItem } from '../../lib/api'
import { toArabicNumerals } from '../../utils/arabicNumerals'
import { ORDER_STATUS_AR, labelOf } from '../../utils/enumLabels'
import '../../styles/DashboardViews.css'

/**
 * Per-request ceiling, matching the server's own (PAGINATION_MAX_PAGE_SIZE).
 *
 * The ledger is capped rather than paged because it exists to show and export
 * everything at once. When the cap bites, the banner says so instead of
 * quietly dropping rows.
 */
const MAX_ROWS = 200

export default function OrdersTransactions({ navigate }: { navigate: (path: string) => void }) {
  const [orders, setOrders] = useState<OrderListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState<string | null>(null)
  const [serverTotals, setServerTotals] = useState({ sales: 0, returns: 0 })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      // Sales and returns in one ledger; the two types are fetched separately
      // because the filter takes one type at a time.
      //
      // Capped rather than paged: the screen's job is to show and export the
      // whole ledger, so paging would export only the visible page. The cap is
      // the server's per-request ceiling, and the banner below reports it when
      // it actually truncates something.
      const [sales, returns] = await Promise.all([
        salesApi.listOrders({ type: 'SALE', pageSize: MAX_ROWS }),
        salesApi.listOrders({ type: 'RETURN', pageSize: MAX_ROWS }),
      ])
      setOrders([...sales.items, ...returns.items])
      setServerTotals({ sales: sales.total, returns: returns.total })
    } catch {
      setNotice('تعذر تحميل حركات البيع.')
    } finally {
      setLoading(false)
    }
  }, []);

  useEffect(() => { void load() }, [load])

  const grid = useDataGrid<OrderListItem>({
    storageKey: 'orders-transactions',
    rowKey: (o) => o.id,
    columns: [
      { key: 'orderNumber', label: 'رقم الطلب' },
      { key: 'createdAt', label: 'التاريخ', value: (o) => new Date(o.createdAt).toLocaleDateString('ar-EG') },
      { key: 'customer', label: 'العميل', value: (o) => o.customer.name },
      { key: 'paymentMethod', label: 'طريقة الدفع', value: (o) => o.paymentMethod?.name || '—' },
      { key: 'carrier', label: 'شركة الشحن', value: (o) => o.carrier?.name || '—' },
      { key: 'shippingCost', label: 'الشحن' },
      { key: 'discountPercentage', label: 'الخصم %' },
      { key: 'orderActualPrice', label: 'الصافي المحصل' },
      { key: 'status', label: 'الحالة', value: (o) => labelOf(ORDER_STATUS_AR, o.status) },
    ]
  })
  const rows = grid.applyFilters(orders)
  const groups = grid.applyGroup(rows)

  const totals = useMemo(() => ({
    net: orders.reduce((s, o) => s + Number(o.orderActualPrice || 0), 0),
    shipping: orders.reduce((s, o) => s + Number(o.shippingCost || 0), 0),
    count: orders.length
  }), [orders])

  return (
    <DashboardLayout navigate={navigate}>
      <div className="view-container">
        <div className="view-header" style={{ marginBottom: '1.5rem' }}>
          <div>
            <h1 className="view-header-title">حركات البيع</h1>
            <p className="view-header-subtitle">كل الطلبات مع قيم التحصيل والشحن وطرق الدفع — مع تصدير كامل.</p>
          </div>
        </div>

        <div className="io-data-surface">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem 1rem', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)' }}>
            <div style={{ display: 'flex', gap: '1.2rem', fontSize: '0.8rem' }}>
              <span>عدد العمليات: <strong>{toArabicNumerals(totals.count)}</strong></span>
              <span>إجمالي المحصل: <strong>{toArabicNumerals(totals.net.toFixed(2))} ج.م</strong></span>
              <span>إجمالي الشحن: <strong>{toArabicNumerals(totals.shipping.toFixed(2))} ج.م</strong></span>
            </div>
            <button type="button" className="io-button io-button-ghost" onClick={() => void load()} disabled={loading}>تحديث</button>
          </div>

          {notice && <div style={{ padding: '0.5rem 1rem', fontSize: '0.8rem', background: 'var(--color-danger-soft)' }}>{notice}</div>}

          {!loading && (serverTotals.sales > MAX_ROWS || serverTotals.returns > MAX_ROWS) && (
            <div style={{ padding: '0.5rem 1rem', fontSize: '0.8rem', background: 'var(--color-warning-soft)', color: 'var(--color-warning)' }}>
              يتم عرض {toArabicNumerals(orders.length)} من {toArabicNumerals(serverTotals.sales + serverTotals.returns)} حركة. التصدير يغطي المعروض فقط.
            </div>
          )}

          <div style={{ padding: '0.65rem 1rem 0' }}>
            <DataGridToolbar grid={grid} rows={rows} />
          </div>

          {loading ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>جاري التحميل...</div>
          ) : (
            <div className="io-table-scroll ao-table-scroll">
              <table className="io-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>رقم الطلب</th>
                    <th>التاريخ</th>
                    <th>العميل</th>
                    <th>طريقة الدفع</th>
                    <th>شركة الشحن</th>
                    <th>الشحن</th>
                    <th>الخصم %</th>
                    <th>الصافي المحصل</th>
                    <th>الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map(group => (
                    group.key !== '_' && (
                      <tr className="dg-group-header" key={`g-${group.key}`}><td colSpan={10}>المجموعة: {group.label} ({toArabicNumerals(group.rows.length)})</td></tr>
                    )
                  )).concat(
                    groups.flatMap(group =>
                      group.rows.map((o, i) => (
                        <tr key={o.id}>
                          <td><span className="io-row-number">{toArabicNumerals(i + 1)}</span></td>
                          <td><span style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{o.orderNumber}</span></td>
                          <td><span style={{ fontSize: '0.8rem' }}>{new Date(o.createdAt).toLocaleDateString('ar-EG')}</span></td>
                          <td><span className="io-item-name">{o.customer.name}</span></td>
                          <td><span>{o.paymentMethod?.name || '—'}</span></td>
                          <td><span>{o.carrier?.name || '—'}</span></td>
                          <td><span>{toArabicNumerals(Number(o.shippingCost || 0).toFixed(2))}</span></td>
                          <td><span>{toArabicNumerals(o.discountPercentage)}%</span></td>
                          <td><strong>{toArabicNumerals(Number(o.orderActualPrice || 0).toFixed(2))} ج.م</strong></td>
                          <td><span>{labelOf(ORDER_STATUS_AR, o.status)}</span></td>
                        </tr>
                      ))
                    )
                  )}
                  {rows.length === 0 && (
                    <tr><td colSpan={10} style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--text-secondary)' }}>لا توجد معاملات.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  )
}
