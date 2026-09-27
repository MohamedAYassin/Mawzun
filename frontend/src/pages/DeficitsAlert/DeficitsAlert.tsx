import { useState, useEffect, useCallback } from 'react'
import DashboardLayout from '../../components/DashboardLayout/DashboardLayout'
import { productionApi, type DeficitLine } from '../../lib/api'
import { toArabicNumerals } from '../../utils/arabicNumerals'
import '../../styles/DashboardViews.css'
import '../AccountingOverview/AccountingOverview.css'

function RefreshIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: '6px' }}>
      <path d="M20 11a8.1 8.1 0 0 0-14.8-4L3 10" /><path d="M3 5v5h5" /><path d="M4 13a8.1 8.1 0 0 0 14.8 4L21 14" /><path d="M21 19v-5h-5" />
    </svg>
  )
}

interface DeficitsAlertProps {
  navigate: (path: string) => void
}

export default function DeficitsAlert({ navigate }: DeficitsAlertProps) {
  const [entries, setEntries] = useState<DeficitLine[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      // Products below their reorder point, per warehouse. The endpoint is
      // paginated, but the whole list fits one page at the client's limit, so
      // the pager still runs client-side over the flattened items.
      // The page state keeps a flat array, so an unexpected shape cannot
      // crash the table — the next best thing is an empty state, not a white
      // screen.
      const result = await productionApi.deficits()
      setEntries(Array.isArray(result) ? result : Array.isArray(result.items) ? result.items : [])
    } catch {
      // Swallowed
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const pageSize = 10
  const totalEntries = entries.length
  const totalPages = Math.max(1, Math.ceil(totalEntries / pageSize))
  const paged = entries.slice((page - 1) * pageSize, page * pageSize)
  // The endpoint is per-warehouse; the top-level rows group lines by product.
  const byProduct = new Map<string, { productId: string; productName: string; skuCode: string | null; lines: DeficitLine[] }>()
  for (const line of paged) {
    const existing = byProduct.get(line.productId)
    if (existing) existing.lines.push(line)
    else byProduct.set(line.productId, { productId: line.productId, productName: line.productName, skuCode: line.skuCode, lines: [line] })
  }

  const toggleExpand = (productId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(productId)) next.delete(productId)
      else next.add(productId)
      return next
    })
  }

  return (
    <DashboardLayout navigate={navigate}>
      <div className="view-container">
        <div className="view-header" style={{ marginBottom: '1.5rem' }}>
          <div>
            <h1 className="view-header-title">جدول عجز المخزون والنواقص</h1>
            <p className="view-header-subtitle">يعرض المنتجات التي انخفض رصيدها عن الحد الأدنى المحدد لكل مستودع، مع تفاصيل العجز لكل مستودع على حدة.</p>
          </div>
        </div>

        <div className="io-data-surface">
          <div style={{ padding: '0.6rem 1.25rem', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong style={{ fontSize: '0.85rem' }}>جدول عجز المخزون والنواقص</strong>
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{toArabicNumerals(totalEntries)} سجل في حالة عجز</span>
              <button
                className="io-button io-button-secondary"
                onClick={() => void loadData()}
                disabled={loading}
                style={{ padding: '0.35rem 0.75rem', minHeight: 'auto', display: 'flex', alignItems: 'center' }}
              >
                <RefreshIcon />
                <span>تحديث</span>
              </button>
            </div>
          </div>

          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '150px', fontSize: '0.85rem' }}>
              جاري التحميل...
            </div>
          ) : entries.length === 0 ? (
            <div className="io-empty-state">
              <h3>مستويات المخزون آمنة!</h3>
              <p>لا توجد أي أصناف حالياً تقل عن الحد الأدنى المحدد للمستودعات.</p>
            </div>
          ) : (
            <>
              <div className="io-table-scroll">
                <table className="io-table">
                  <thead>
                    <tr>
                      <th style={{ width: '24px', padding: '0.6rem 0.9rem' }}></th>
                      <th style={{ padding: '0.6rem 0.9rem' }}>المنتج</th>
                      <th style={{ padding: '0.6rem 0.9rem' }}>كود الصنف</th>
                      <th style={{ padding: '0.6rem 0.9rem' }}>الرصيد المتاح</th>
                      <th style={{ padding: '0.6rem 0.9rem' }}>الحد الأدنى المطلوب</th>
                      <th style={{ padding: '0.6rem 0.9rem' }}>العجز الصافي</th>
                      <th style={{ padding: '0.6rem 0.9rem' }}>الإجراء</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...byProduct.values()].flatMap(({ productId, productName, skuCode, lines }) => {
                      const rows: React.ReactNode[] = []
                      const min = lines.reduce((s, l) => s + l.minStockLevel, 0)
                      const avail = lines.reduce((s, l) => s + l.availableQuantity, 0)
                      const netDeficit = lines.reduce((s, l) => s + l.deficit, 0)
                      rows.push(
                        <tr key={productId} style={{ cursor: 'pointer' }} onClick={() => toggleExpand(productId)}>
                          <td style={{ textAlign: 'center', padding: '0.6rem 0.9rem' }}>
                            <span style={{ fontSize: '0.7rem' }}>
                              {expanded.has(productId) ? '▲' : '▼'}
                            </span>
                          </td>
                          <td style={{ padding: '0.6rem 0.9rem' }}><span className="io-item-name">{productName}</span></td>
                          <td style={{ padding: '0.6rem 0.9rem' }}><span className="io-related-badge" style={{ fontFamily: 'monospace' }}>{skuCode}</span></td>
                          <td style={{ padding: '0.6rem 0.9rem' }}><strong>{toArabicNumerals(avail)}</strong></td>
                          <td style={{ padding: '0.6rem 0.9rem' }}><span>{toArabicNumerals(min)}</span></td>
                          <td style={{ padding: '0.6rem 0.9rem' }}><strong style={{ fontSize: '0.85rem' }}>{toArabicNumerals(netDeficit)}</strong></td>
                          <td style={{ padding: '0.6rem 0.9rem' }}>
                            <button
                              className="io-button"
                              style={{
                                minHeight: 0,
                                padding: '0.4rem 0.9rem',
                                fontSize: '0.78rem',
                                fontWeight: 700,
                                background: 'var(--color-success)',
                                color: 'var(--color-accent-contrast)',
                                border: '1px solid #15803d',
                                borderRadius: 'var(--radius-md)',
                                cursor: 'pointer',
                                transition: 'all 0.15s ease',
                                boxShadow: '0 2px 5px rgba(22, 163, 74, 0.2)'
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.background = '#15803d';
                                e.currentTarget.style.transform = 'translateY(-1px)';
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.background = 'var(--color-success)';
                                e.currentTarget.style.transform = 'none';
                              }}
                              onMouseDown={(e) => {
                                e.currentTarget.style.transform = 'scale(0.98)';
                              }}
                              onMouseUp={(e) => {
                                e.currentTarget.style.transform = 'translateY(-1px)';
                              }}
                              onClick={(e) => {
                                e.stopPropagation();
                                navigate('/dashboard/production');
                              }}
                            >
                              جدولة تصنيع
                            </button>
                          </td>
                        </tr>
                      )
                        if (expanded.has(productId)) {
                        lines.forEach((w, wi) => {
                          rows.push(
                            <tr key={`${productId}-w-${wi}`} style={{ background: 'var(--bg-canvas)' }}>
                              <td style={{ padding: '0.5rem 0.9rem' }}></td>
                              <td style={{ padding: '0.5rem 0.9rem', paddingRight: '2.25rem' }}>
                                <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>▸ {w.warehouseName}</span>
                              </td>
                              <td style={{ padding: '0.5rem 0.9rem' }}></td>
                              <td style={{ padding: '0.5rem 0.9rem' }}><span style={{ fontSize: '0.8rem' }}>{toArabicNumerals(w.availableQuantity)}</span></td>
                              <td style={{ padding: '0.5rem 0.9rem' }}>
                                <span style={{ fontSize: '0.8rem' }}>
                                  {toArabicNumerals(w.minStockLevel)} — {toArabicNumerals(w.maxStockLevel)}
                                </span>
                              </td>
                              <td style={{ padding: '0.5rem 0.9rem' }}>
                                {w.deficit > 0
                                  ? <strong style={{ fontSize: '0.8rem', color: 'var(--color-danger)' }}>{toArabicNumerals(w.deficit)}</strong>
                                  : <span style={{ fontSize: '0.8rem', color: 'var(--color-success)' }}>مكتفي</span>
                                }
                              </td>
                              <td style={{ padding: '0.5rem 0.9rem' }}></td>
                            </tr>
                          )
                        })
                      }
                      return rows
                    })}
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
                  <span style={{ fontSize: '0.8rem' }}>
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
