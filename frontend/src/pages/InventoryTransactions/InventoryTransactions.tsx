import { useCallback, useEffect, useState } from 'react'
import DashboardLayout from '../../components/DashboardLayout/DashboardLayout'
import {
  inventoryApi,
  catalogApi,
  type InventoryTransaction,
  type ProductListItem,
  type StorageLocation,
} from '../../lib/api'
import { toArabicNumerals } from '../../utils/arabicNumerals'
import '../../styles/DashboardViews.css'
import '../AccountingOverview/AccountingOverview.css'

type Notice = {
  type: 'success' | 'error' | 'info'
  text: string
}

// The API's InventoryTransactionType enum, in the order an operator reads it.
// These values are the real enum members (verified against pg_enum) — the old
// list offered IN / OUT / TRANSFER / ADJUSTMENT, none of which exist in the
// database, so every filter selection matched zero rows.
const transactionTypeOptions = [
  { value: '', label: 'كل الأنواع' },
  { value: 'OPENING', label: 'رصيد افتتاحي' },
  { value: 'PURCHASE', label: 'شراء' },
  { value: 'SALE', label: 'بيع' },
  { value: 'RETURN_IN', label: 'مرتجع وارد' },
  { value: 'RETURN_OUT', label: 'مرتجع صادر' },
  { value: 'TRANSFER_IN', label: 'تحويل وارد' },
  { value: 'TRANSFER_OUT', label: 'تحويل صادر' },
  { value: 'ADJUSTMENT_IN', label: 'تسوية بالزيادة' },
  { value: 'ADJUSTMENT_OUT', label: 'تسوية بالنقص' },
  { value: 'PRODUCTION_IN', label: 'إنتاج وارد' },
  { value: 'PRODUCTION_OUT', label: 'إنتاج صادر' },
  { value: 'SCRAP', label: 'هالك' },
  { value: 'COUNT_VARIANCE', label: 'فرق جرد' },
]


const TYPE_LABEL: Record<string, string> = Object.fromEntries(
  transactionTypeOptions.filter(o => o.value).map(o => [o.value, o.label])
)

/** Types that add stock. Everything else removes or re-values it. */
const INBOUND_TYPES = new Set(['OPENING', 'PURCHASE', 'RETURN_IN', 'TRANSFER_IN', 'ADJUSTMENT_IN', 'PRODUCTION_IN'])

/** Arabic label for an inventory transaction type, raw value if unmapped. */
function typeLabel(value: string): string {
  return TYPE_LABEL[value] ?? value
}

function StatusBanner({ notice }: { notice: Notice | null }) {
  if (!notice) return null
  return (
    <div style={{ padding: '0.5rem 1rem', fontSize: '0.8rem', background: notice.type === 'success' ? '#e6ffe6' : notice.type === 'error' ? 'var(--color-danger-soft)' : '#e6f3ff', borderBottom: '1px solid var(--border-color)' }}>
      {notice.text}
    </div>
  )
}

function RefreshIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 11a8.1 8.1 0 0 0-14.8-4L3 10" /><path d="M3 5v5h5" /><path d="M4 13a8.1 8.1 0 0 0 14.8 4L21 14" /><path d="M21 19v-5h-5" />
    </svg>
  )
}



export default function InventoryTransactions({ navigate }: { navigate: (path: string) => void }) {
  const [entries, setEntries] = useState<InventoryTransaction[]>([])
  const [products, setProducts] = useState<ProductListItem[]>([])
  const [locations, setLocations] = useState<StorageLocation[]>([])
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState<Notice | null>(null)

  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [productFilter, setProductFilter] = useState('')
  const [locationFilter, setLocationFilter] = useState('')

  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [totalEntries, setTotalEntries] = useState(0)
  const pageSize = 10

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [result, pRes, lRes] = await Promise.all([
        inventoryApi.listStockTransactions({
          search: search || undefined,
          productId: productFilter || undefined,
          storageLocationId: locationFilter || undefined,
          page,
          pageSize,
        }),
        catalogApi.listProducts({ pageSize: 200 }).catch(() => ({ items: [] as ProductListItem[] })),
        inventoryApi.listStorageLocations().catch(() => [] as StorageLocation[]),
      ])
      const visible = typeFilter ? result.items.filter((item) => item.transactionType === typeFilter) : result.items
      setEntries(visible)
      setTotalPages(result.totalPages)
      setTotalEntries(result.total)
      setProducts(pRes.items)
      setLocations(lRes)
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'تعذر تحميل الحركات.' })
    } finally {
      setLoading(false)
    }
  }, [search, typeFilter, productFilter, locationFilter, page, pageSize])

  useEffect(() => {
    void load()
  }, [load])

  const disabled = loading

  return (
    <DashboardLayout navigate={navigate}>
      <div className="view-container">
        <div className="view-header" style={{ marginBottom: '1.5rem' }}>
          <div>
            <h1 className="view-header-title">حركات المخزن</h1>
            <p className="view-header-subtitle">سجل جميع حركات المخزون — وارد، صادر، تحويل، وتسوية جردية.</p>
          </div>
        </div>

        <div className="io-data-surface">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem 1rem', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)' }}>
            <strong style={{ fontSize: '0.85rem' }}>سجل الحركات</strong>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{toArabicNumerals(totalEntries)} حركة</span>
              <button type="button" className="io-button io-button-ghost" onClick={() => void load()} disabled={disabled} style={{ fontSize: '0.8rem', padding: '0.3rem 0.6rem' }}><RefreshIcon /> تحديث</button>
            </div>
          </div>

          <div className="ao-filter-bar" style={{ flexWrap: 'wrap' }}>
            <input type="text" placeholder="ابحث باسم المنتج، المرجع، أو السبب..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} />
            <select style={{ padding: '0.5rem 0.75rem', border: '1px solid var(--border-color)', borderRadius: 6, background: 'var(--bg-primary)', fontSize: '0.8rem', fontFamily: 'var(--font-body)' }} value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(1) }}>
              {transactionTypeOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <select style={{ padding: '0.5rem 0.75rem', border: '1px solid var(--border-color)', borderRadius: 6, background: 'var(--bg-primary)', fontSize: '0.8rem', fontFamily: 'var(--font-body)' }} value={productFilter} onChange={(e) => { setProductFilter(e.target.value); setPage(1) }}>
              <option value={0}>كل المنتجات</option>
              {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <select style={{ padding: '0.5rem 0.75rem', border: '1px solid var(--border-color)', borderRadius: 6, background: 'var(--bg-primary)', fontSize: '0.8rem', fontFamily: 'var(--font-body)' }} value={locationFilter} onChange={(e) => { setLocationFilter(e.target.value); setPage(1) }}>
              <option value={0}>كل المواقع</option>
              {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>

          <StatusBanner notice={notice} />

          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '150px', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
              جاري التحميل...
            </div>
          ) : entries.length === 0 ? (
            <div className="io-empty-state">
              <h3>لا توجد حركات مخزنية</h3>
              <p>{search || typeFilter || productFilter || locationFilter ? 'لا توجد نتائج تطابق معايير البحث.' : 'لم يتم تسجيل أي حركات مخزنية بعد.'}</p>
            </div>
          ) : (
            <>
              <div className="io-table-scroll ao-table-scroll">
                <table className="io-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>التاريخ والوقت</th>
                      <th>المنتج</th>
                      <th>موقع التخزين</th>
                      <th>نوع الحركة</th>
                      <th>الكمية</th>
                      <th>الرصيد بعد</th>
                      <th>تكلفة الوحدة</th>
                      <th>رقم المرجع</th>
                      <th>الملاحظة</th>
                      <th>بواسطة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((item, index) => (
                      <tr key={item.id}>
                        <td><span className="io-row-number">{(page - 1) * pageSize + index + 1}</span></td>
                        <td><span>{new Date(item.createdAt).toLocaleString('ar-EG', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}</span></td>
                        <td><span className="io-item-name">{item.product.name}</span></td>
                        <td><span className="io-related-badge" style={{ background: 'var(--bg-secondary)' }}>{item.storageLocation.name}</span></td>
                        <td>
                          {/* Inbound types share a tone; everything else reads as
                              an outflow. The old test compared against 'IN',
                              which is not an enum member, so every row took the
                              danger branch. */}
                          <span style={{
                            background: INBOUND_TYPES.has(item.transactionType) ? 'var(--color-success-soft)' : 'var(--color-danger-soft)',
                            color: INBOUND_TYPES.has(item.transactionType) ? 'var(--color-success)' : 'var(--color-danger)',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            fontSize: '0.85rem',
                          }}>
                            {typeLabel(item.transactionType)}
                          </span>
                        </td>
                        <td><strong style={{ fontSize: '0.85rem' }}>{toArabicNumerals(item.quantity)}</strong></td>
                        <td>{toArabicNumerals(item.balanceAfter)}</td>
                        <td>{item.unitCost != null ? Number(item.unitCost).toLocaleString('ar-EG') : '—'}</td>
                        <td><span style={{ fontFamily: 'monospace' }}>{item.referenceNumber || '—'}</span></td>
                        <td><span>{item.reason || '—'}</span></td>
                        <td><span style={{ background: 'var(--border-color)', color: 'var(--text-secondary)', padding: '2px 6px', borderRadius: '4px', fontSize: '0.8rem' }}>{item.actor?.fullName || 'مسؤول'}</span></td>
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
                    الصفحة {toArabicNumerals(page)} من {toArabicNumerals(totalPages)}
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
