import { useCallback, useEffect, useMemo, useState } from 'react'
import DashboardLayout from '../../components/DashboardLayout/DashboardLayout'
import { DataGridToolbar, useDataGrid } from '../../components/DataGrid/DataGrid'
import { purchasingApi, type PurchaseOrderListItem } from '../../lib/api'
import { toArabicNumerals } from '../../utils/arabicNumerals'
import { PURCHASE_ORDER_STATUS_AR, labelOf } from '../../utils/enumLabels'
import '../../styles/DashboardViews.css'

export default function PurchaseTransactions({ navigate }: { navigate: (path: string) => void }) {
  const [orders, setOrders] = useState<PurchaseOrderListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const result = await purchasingApi.listPurchaseOrders({ page: 1, pageSize: 200 })
      setOrders(result.items)
    } catch {
      setNotice('تعذر تحميل حركات الشراء.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const grid = useDataGrid<PurchaseOrderListItem>({
    storageKey: 'purchase-transactions',
    rowKey: (o) => o.id,
    columns: [
      { key: 'orderNumber', label: 'رقم الأمر' },
      { key: 'createdAt', label: 'التاريخ', value: (o) => new Date(o.createdAt).toLocaleDateString('ar-EG') },
      { key: 'vendor', label: 'المورد', value: (o) => o.vendor.name },
      { key: 'status', label: 'الحالة', value: (o) => labelOf(PURCHASE_ORDER_STATUS_AR, String(o.status)) },
      { key: 'totalAmount', label: 'القيمة' },
    ]
  })
  const rows = grid.applyFilters(orders)
  const groups = grid.applyGroup(rows)

  const total = useMemo(() => orders.reduce((s, o) => s + Number(o.totalAmount || 0), 0), [orders])

  return (
    <DashboardLayout navigate={navigate}>
      <div className="view-container">
        <div className="view-header" style={{ marginBottom: '1.5rem' }}>
          <div>
            <h1 className="view-header-title">حركات الشراء</h1>
            <p className="view-header-subtitle">قيمة أوامر الشراء وحالتها السداد — مع تصدير كامل.</p>
          </div>
        </div>

        <div className="io-data-surface">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem 1rem', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)' }}>
            <span style={{ fontSize: '0.8rem' }}>إجمالي القيمة: <strong>{toArabicNumerals(total.toFixed(2))} ج.م</strong> · {toArabicNumerals(orders.length)} أمر شراء</span>
            <button type="button" className="io-button io-button-ghost" onClick={() => void load()} disabled={loading}>تحديث</button>
          </div>

          {notice && <div style={{ padding: '0.5rem 1rem', fontSize: '0.8rem', background: 'var(--color-danger-soft)' }}>{notice}</div>}

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
                    <th>رقم الأمر</th>
                    <th>التاريخ</th>
                    <th>المورد</th>
                    <th>الحالة</th>
                    <th>القيمة</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map(group =>
                    group.key !== '_' && (
                      <tr className="dg-group-header" key={`g-${group.key}`}><td colSpan={6}>المجموعة: {group.label} ({toArabicNumerals(group.rows.length)})</td></tr>
                    )
                  ).concat(
                    groups.flatMap(group =>
                      group.rows.map((o, i) => (
                        <tr key={o.id}>
                          <td><span className="io-row-number">{toArabicNumerals(i + 1)}</span></td>
                          <td><span style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{o.orderNumber}</span></td>
                          <td><span style={{ fontSize: '0.8rem' }}>{new Date(o.createdAt).toLocaleDateString('ar-EG')}</span></td>
                          <td><span className="io-item-name">{o.vendor.name}</span></td>
                          <td><span>{labelOf(PURCHASE_ORDER_STATUS_AR, String(o.status))}</span></td>
                          <td><strong>{toArabicNumerals(Number(o.totalAmount || 0).toFixed(2))} ج.م</strong></td>
                        </tr>
                      ))
                    )
                  )}
                  {rows.length === 0 && (
                    <tr><td colSpan={6} style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--text-secondary)' }}>لا توجد معاملات مشتريات.</td></tr>
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
