import { useCallback, useEffect, useMemo, useState } from 'react'
import DashboardLayout from '../../components/DashboardLayout/DashboardLayout'
import { reportsApi, type StockReportRow } from '../../lib/api'
import { Button, EmptyState, LoadingState, ListToolbar, ModuleHeading, StatusBanner, BoxIcon, type Notice } from '../shared/ManagementUi'
import '../SystemSettings/SystemSettings.css'

interface ProductStocksProps {
  navigate: (path: string) => void
}

function formatMoney(value: string | number) {
  return Number(value).toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function ProductStocks({ navigate }: ProductStocksProps) {
  const [rows, setRows] = useState<StockReportRow[]>([])
  const [totals, setTotals] = useState({ totalQuantity: 0, reservedQuantity: 0, availableQuantity: 0, totalCost: 0, rowCount: 0 })
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [lastLoaded, setLastLoaded] = useState<Date | null>(null)

  useEffect(() => {
    const timer = setTimeout(() => { setDebouncedQuery(query); setPage(1) }, 350)
    return () => clearTimeout(timer)
  }, [query])

  const load = useCallback(async (showLoader = true, search = debouncedQuery, currentPage = page) => {
    if (showLoader) setLoading(true)
    try {
      const [page, totals] = await Promise.all([
        reportsApi.stockReport({ search: search || undefined, page: currentPage, pageSize: 10 }),
        reportsApi.stockTotals(),
      ])
      setRows(page.items)
      setTotalCount(page.total)
      setTotalPages(Math.max(page.totalPages, 1))
      setTotals({ totalQuantity: totals.totalQuantity, reservedQuantity: totals.reservedQuantity, availableQuantity: totals.availableQuantity, totalCost: totals.totalCost, rowCount: totals.rowCount })
      setLastLoaded(new Date())
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'تعذر تحميل أرصدة المنتجات.' })
    } finally { setLoading(false) }
  }, [debouncedQuery, page])

  useEffect(() => { void load() }, [load])

  const visible = useMemo(() => rows, [rows])

  return (
    <DashboardLayout navigate={navigate}>
      <div className="view-container">
        <section className="ss-module animate-fade-in">
          <ModuleHeading icon={<BoxIcon />} eyebrow="المخازن" title="أرصدة المنتجات" subtitle="الكميات والتكاليف لكل منتج في كل موقع تخزين." />
          <div className="ss-module-actions">
            <span className="ss-count-chip"><strong>{totalCount}</strong> سجل</span>
            <span className="ss-count-chip">إجمالي الكمية <strong>{totals.totalQuantity.toLocaleString('ar-EG')}</strong></span><span className="ss-count-chip">المحجوز <strong>{totals.reservedQuantity.toLocaleString('ar-EG')}</strong></span><span className="ss-count-chip">المتاح <strong>{totals.availableQuantity.toLocaleString('ar-EG')}</strong></span>
            <span className="ss-count-chip">إجمالي التكلفة <strong>{formatMoney(totals.totalCost)}</strong> ج.م</span>
            <Button variant="ghost" onClick={() => void load()} disabled={loading}>تحديث</Button>
          </div>
          <StatusBanner notice={notice} />
          <div className="ss-list-toolbar">
            <ListToolbar query={query} setQuery={setQuery} placeholder="ابحث باسم المنتج أو الكود..." lastLoaded={lastLoaded} />
          </div>
          <div className="ss-data-surface">
            {loading ? <LoadingState /> : visible.length === 0 ? <EmptyState hasSearch={Boolean(debouncedQuery.trim())} /> : (
              <div className="ss-table-scroll">
                <table className="ss-table">
                  <thead><tr><th>#</th><th>المنتج</th><th>التصنيف</th><th>الموقع</th><th>المخزن</th><th>الكمية</th><th>تكلفة الوحدة</th><th>إجمالي التكلفة</th></tr></thead>
                  <tbody>
                    {visible.map((row, index) => (
                      <tr key={row.id}>
                        <td>{(page - 1) * 20 + index + 1}</td>
                        <td>{row.productName}</td>
                        <td>{row.categoryName || '—'}</td>
                        <td>{row.locationName}</td>
                        <td>{row.warehouseName}</td>
                        <td>{row.quantityOnHand.toLocaleString('ar-EG')}</td>
                        <td>{formatMoney(row.unitCost)}</td>
                        <td>{formatMoney(row.totalCost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          {totalPages > 1 && (
            <div className="ss-list-toolbar" style={{ justifyContent: 'center', marginTop: '1rem' }}>
              <Button variant="ghost" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={loading || page <= 1}>السابق</Button>
              <span className="ss-count-chip">صفحة {page} من {totalPages}</span>
              <Button variant="ghost" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={loading || page >= totalPages}>التالي</Button>
            </div>
          )}
        </section>
      </div>
    </DashboardLayout>
  )
}
