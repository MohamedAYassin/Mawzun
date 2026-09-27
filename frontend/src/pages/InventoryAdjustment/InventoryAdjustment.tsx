import { useCallback, useEffect, useMemo, useState } from 'react'
import DashboardLayout from '../../components/DashboardLayout/DashboardLayout'
import { inventoryApi, reportsApi, type StockReportRow, type StorageLocation } from '../../lib/api'
import { toArabicNumerals } from '../../utils/arabicNumerals'
import '../../styles/DashboardViews.css'

type CountRow = StockReportRow & { counted: string }

/**
 * How many stock rows the count sheet loads at once.
 *
 * One page by design: this is a form, so rows must not be swapped out from
 * under quantities the user has already typed. This is the server's own
 * per-request ceiling (PAGINATION_MAX_PAGE_SIZE), so it asks for everything a
 * single request is allowed to return. If it ever bites, the notice above the
 * table says so and points at the location filter.
 */
const MAX_ROWS = 200

export default function InventoryAdjustment({ navigate }: { navigate: (path: string) => void }) {
  const [locations, setLocations] = useState<StorageLocation[]>([])
  const [locationId, setLocationId] = useState('')
  const [rows, setRows] = useState<CountRow[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [search, setSearch] = useState('')
  const [totalAvailable, setTotalAvailable] = useState(0)

  useEffect(() => {
    inventoryApi.listStorageLocations().then(setLocations).catch(() => setLocations([]))
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      // Capped, not paged, and the cap is surfaced below when it bites.
      //
      // This screen is a data-entry form: the user types counted quantities and
      // then saves. Paging would replace `rows` on every page change and throw
      // away the counts already entered, so the list stays on one page and the
      // ceiling is raised instead. The old 200 was silent — past it, products
      // simply did not appear, with nothing on screen to say so.
      const page = await reportsApi.stockReport({ page: 1, pageSize: MAX_ROWS })
      setRows(page.items.map(r => ({ ...r, counted: '' })))
      setTotalAvailable(page.total)
    } catch {
      setNotice({ type: 'error', text: 'تعذر تحميل أرصدة المنتجات.' })
    } finally {
      setLoading(false)
    }
  }, []);

  useEffect(() => { void load() }, [load])

  const locationRows = useMemo(() => {
    const atLocation = locationId ? rows.filter(r => r.locationId === locationId) : rows
    const q = search.trim().toLowerCase()
    if (!q) return atLocation
    return atLocation.filter(r => r.productName.toLowerCase().includes(q))
  }, [rows, locationId, search])

  const countedRows = locationRows.filter(r => r.counted !== '' && Number(r.counted) !== r.quantityOnHand)

  const saveAdjustments = async () => {
    if (!countedRows.length) {
      setNotice({ type: 'error', text: 'لا توجد فروقات لتسجيلها — أدخل الكميات الفعلية أولاً.' })
      return
    }
    if (!window.confirm(`سيتم تسجيل ${countedRows.length} تسوية جرد لملاءمة الأرصدة الفعلية. متابعة؟`)) return
    setSaving(true)
    setNotice(null)
    let failed = 0
    try {
      for (const row of countedRows) {
        try {
          // The adjust endpoint takes the counted quantity and works out the
          // correction; direction is the server decision, not the client.
          await inventoryApi.adjustStock({
            productId: row.productId,
            storageLocationId: row.locationId,
            countedQuantity: Number(row.counted),
            reason: 'تسوية جرد',
          })
        } catch { failed++ }
      }
      setNotice(failed ? { type: 'error', text: `تم تسجيل بعض التسويات، فشل ${failed}.` } : { type: 'success', text: `تم تسجيل ${countedRows.length} تسوية جرد بنجاح.` })
      await load()
    } finally {
      setSaving(false)
    }
  }

  return (
    <DashboardLayout navigate={navigate}>
      <div className="view-container">
        <div className="view-header" style={{ marginBottom: '1.5rem' }}>
          <div>
            <h1 className="view-header-title">الجرد الفعلي</h1>
            <p className="view-header-subtitle">اختر مكان التخزين، أدخل الكميات الفعلية بعد العد، وسيسجل النظام الفروقات كتسويات جرد.</p>
          </div>
        </div>

        <div className="io-data-surface">
          <div className="ao-filter-bar" style={{ flexWrap: 'wrap' }}>
            <select
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              style={{ padding: '0.5rem 0.75rem', border: '1px solid var(--border-color)', borderRadius: 6, background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '0.8rem', fontFamily: 'var(--font-body)', minWidth: 220 }}
            >
              <option value="">كل أماكن التخزين</option>
              {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
            <input type="text" placeholder="ابحث عن منتج..." value={search} onChange={(e) => setSearch(e.target.value)} />
            <button type="button" className="io-button io-button-ghost" onClick={() => void load()} disabled={loading}>تحديث</button>
          </div>

          {notice && (
            <div style={{ padding: '0.5rem 1rem', fontSize: '0.8rem', background: notice.type === 'success' ? '#e6ffe6' : 'var(--color-danger-soft)' }}>{notice.text}</div>
          )}

          {!loading && totalAvailable > rows.length && (
            <div style={{ padding: '0.5rem 1rem', fontSize: '0.8rem', background: 'var(--color-warning-soft)', color: 'var(--color-warning)' }}>
              يتم عرض {toArabicNumerals(rows.length)} من {toArabicNumerals(totalAvailable)} صفًا. ضيّق النطاق بمكان تخزين محدد أو بالبحث لتسوية الباقي.
            </div>
          )}

          {loading ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>جاري التحميل...</div>
          ) : (
            <>
              <div className="io-table-scroll ao-table-scroll">
                <table className="io-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>مكان التخزين</th>
                      <th>المنتج</th>
                      <th>الكمية في النظام</th>
                      <th>الكمية الحقيقية</th>
                      <th>الفارق بينهم</th>
                    </tr>
                  </thead>
                  <tbody>
                    {locationRows.map((row, i) => {
                      const counted = row.counted === '' ? null : Number(row.counted)
                      const delta = counted === null ? null : counted - row.quantityOnHand
                      return (
                        <tr key={row.id}>
                          <td><span className="io-row-number">{toArabicNumerals(i + 1)}</span></td>
                          <td><span>{row.locationName}</span></td>
                          <td><span className="io-item-name">{row.productName}</span></td>
                          <td><span>{toArabicNumerals(row.quantityOnHand)}</span></td>
                          <td>
                            <input
                              type="number"
                              min="0"
                              value={row.counted}
                              onChange={(e) => setRows(prev => prev.map(r => r.id === row.id ? { ...r, counted: e.target.value } : r))}
                              style={{ width: 90, padding: '0.3rem 0.5rem', border: '1px solid var(--border-color)', borderRadius: 6, background: 'var(--bg-primary)', color: 'var(--text-primary)', fontFamily: 'inherit' }}
                              placeholder="—"
                            />
                          </td>
                          <td>
                            {delta === null
                              ? <span style={{ color: 'var(--text-secondary)' }}>—</span>
                              : <span style={{ color: delta === 0 ? 'var(--text-secondary)' : delta > 0 ? '#2e7d32' : '#c62828', fontWeight: 700 }}>
                                  {delta > 0 ? '+' : ''}{toArabicNumerals(delta)}
                                </span>}
                          </td>
                        </tr>
                      )
                    })}
                    {locationRows.length === 0 && (
                      <tr><td colSpan={6} style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--text-secondary)' }}>لا توجد أرصدة في مكان التخزين المحدد.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem 1rem', borderTop: '1px solid var(--border-color)' }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{toArabicNumerals(countedRows.length)} تسوية جاهزة للسجل</span>
                <button type="button" className="io-button io-button-primary" onClick={() => void saveAdjustments()} disabled={saving || !countedRows.length}>
                  {saving ? 'جاري الحفظ...' : 'حفظ التسويات'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </DashboardLayout>
  )
}
