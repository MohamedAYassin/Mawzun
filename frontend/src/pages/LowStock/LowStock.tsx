import { useCallback, useEffect, useState } from 'react'
import DashboardLayout from '../../components/DashboardLayout/DashboardLayout'
import { toArabicNumerals } from '../../utils/arabicNumerals'
import { catalogApi, type ProductListItem } from '../../lib/api'
import { ModuleHeading, StatusBanner, ListToolbar, LoadingState, EmptyState, Button, BoxIcon, TagIcon, type Notice } from '../shared/ManagementUi'
import '../SystemSettings/SystemSettings.css'

interface LowStockProps {
  navigate: (path: string) => void
}

const THRESHOLDS = [3, 5, 10, 20]
const PAGE_SIZE = 10

function formatMoney(value: string | number): string {
  return Number(value).toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function LowStockView() {
  const [items, setItems] = useState<ProductListItem[]>([])
  const [query, setQuery] = useState('')
  const [threshold, setThreshold] = useState(5)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [totalEntries, setTotalEntries] = useState(0)
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [lastLoaded, setLastLoaded] = useState<Date | null>(null)

  const load = useCallback(async (showLoader = true, currentPage = page, currentThreshold = threshold, currentQuery = query) => {
    if (showLoader) setLoading(true)
    try {
      // Filtered, searched and paged by the server. Previously this pulled 200
      // products and did all three in the browser, which silently dropped every
      // low-stock product past the 200th once the catalogue grew.
      //
      // The threshold and the search term go to the server too, so the count in
      // the chip and the pager describe the same set the table is showing —
      // filtering the visible page would make both of them lie.
      const result = await catalogApi.listProducts({
        page: currentPage,
        pageSize: PAGE_SIZE,
        isActive: true,
        lowStockOnly: true,
        lowStockThreshold: currentThreshold,
        search: currentQuery.trim() || undefined,
      })
      setItems(result.items)
      setTotalPages(result.totalPages)
      setTotalEntries(result.total)
      setLastLoaded(new Date())
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'تعذر تحميل المنتجات.' })
    } finally { setLoading(false) }
  }, [page, threshold, query])

  useEffect(() => { void load() }, [load])

  const goToPage = (next: number) => {
    // Only state changes: `load` depends on `page`, so the effect refetches once.
    setPage(next)
  }

  const applyThreshold = (next: number) => {
    // A wider or narrower net changes the result set, so the pager restarts.
    setThreshold(next)
    setPage(1)
  }

  const applyQuery = (next: string) => {
    // Same reasoning: a different search term is a different result set.
    setQuery(next)
    setPage(1)
  }

  return (
    <section className="ss-module animate-fade-in">
      <ModuleHeading icon={<BoxIcon />} eyebrow="المخازن" title="المخزون المنخفض (Low Stock)" subtitle="المنتجات النشطة التي وصل مخزونها إلى الحد الأدنى ويلزم إعادة توريدها." />
      <div className="ss-module-actions">
        <span className="ss-count-chip"><strong>{toArabicNumerals(totalEntries)}</strong> منتج منخفض</span>
        <Button variant="ghost" onClick={() => void load()} disabled={loading}><TagIcon size={16} /> تحديث</Button>
      </div>
      <StatusBanner notice={notice} />
      <div className="ss-list-toolbar">
        <ListToolbar query={query} setQuery={applyQuery} placeholder="ابحث بالاسم أو الباركود أو SKU..." lastLoaded={lastLoaded} />
        <label className="ss-search" style={{ minWidth: '170px' }}>
          <span>الحد الأدنى:</span>
          <select value={threshold} onChange={(event) => applyThreshold(Number(event.target.value))} aria-label="حد المخزون الأدنى" className="ss-input">
            {THRESHOLDS.map((value) => <option key={value} value={value}>{`≤ ${value}`}</option>)}
          </select>
        </label>
      </div>
      <div className="ss-data-surface">
        {loading ? <LoadingState /> : items.length === 0 ? <EmptyState hasSearch={Boolean(query.trim())} /> : (
          <div className="ss-table-scroll">
            <table className="ss-table">
              <thead><tr><th>#</th><th>المنتج</th><th>SKU</th><th>الباركود</th><th>الماركة</th><th>الفعلي</th><th>المحجوز</th><th>المتاح</th><th>السعر</th></tr></thead>
              <tbody>
                {items.map((item, index) => (
                  <tr key={item.id}>
                    <td><span className="ss-row-number">{toArabicNumerals((page - 1) * PAGE_SIZE + index + 1)}</span></td>
                    <td><span className="ss-item-name">{item.name}</span></td>
                    <td><span dir="ltr">{item.skuCode || '—'}</span></td>
                    <td><span dir="ltr">{item.barcode || '—'}</span></td>
                    <td><span>{item.brand?.name || '—'}</span></td>
                    <td>{toArabicNumerals(String(item.onHand ?? '—'))}</td>
                    <td>{toArabicNumerals(String(item.reserved ?? '—'))}</td>
                    <td>
                      <span className="ss-related-badge" style={{ background: item.available === 0 ? 'var(--color-danger-soft)' : 'var(--color-warning-soft)', color: item.available === 0 ? 'var(--color-danger)' : 'var(--color-warning)' }}>
                        {toArabicNumerals(item.available)}
                      </span>
                    </td>
                    <td><span>{formatMoney(item.price)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {!loading && totalPages > 1 && (
        <div className="ss-list-toolbar" style={{ justifyContent: 'center' }}>
          <Button variant="ghost" onClick={() => goToPage(page - 1)} disabled={page <= 1 || loading}>السابق</Button>
          <span className="ss-count-chip">صفحة {toArabicNumerals(page)} من {toArabicNumerals(totalPages)}</span>
          <Button variant="ghost" onClick={() => goToPage(page + 1)} disabled={page >= totalPages || loading}>التالي</Button>
        </div>
      )}
    </section>
  )
}

export default function LowStock({ navigate }: LowStockProps) {
  return (
    <DashboardLayout navigate={navigate}>
      <div className="view-container">
        <LowStockView />
      </div>
    </DashboardLayout>
  )
}
