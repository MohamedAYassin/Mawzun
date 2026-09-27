import { useState, useEffect, useMemo, type FormEvent } from 'react'
import DashboardLayout from '../../components/DashboardLayout/DashboardLayout'
import { salesApi, productionApi, type OrderListItem } from '../../lib/api'
import { toArabicNumerals } from '../../utils/arabicNumerals'
import '../Production/Production.css'

interface AddBatchProps {
  navigate: (path: string) => void
}

export default function AddBatch({ navigate }: AddBatchProps) {
  const [allOrders, setAllOrders] = useState<OrderListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [notes, setNotes] = useState('')
  const [startDate, setStartDate] = useState(new Date().toISOString().substring(0, 10))
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([])
  const [orderSearch, setOrderSearch] = useState('')
  const [orderFilter, setOrderFilter] = useState('all')
  const [orderPage, setOrderPage] = useState(1)
  const orderPageSize = 10

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        const sales = await salesApi.listOrders({ type: 'SALE', pageSize: 200 }).catch(() => ({ items: [] as OrderListItem[] }))
        setAllOrders(sales.items)
      } catch {
        setError('حدث خطأ أثناء تحميل الطلبات.')
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [])

  const eligibleOrders = useMemo(() => {
    return allOrders.filter(o =>
      o.status !== 'CANCELLED' && o.status !== 'RETURNED'
    )
  }, [allOrders])

  const filteredEligibleOrders = useMemo(() => {
    const q = orderSearch.trim().toLowerCase()
    let result = eligibleOrders
    if (q) {
      result = result.filter(o =>
        o.orderNumber.toLowerCase().includes(q) ||
        o.customer.name.toLowerCase().includes(q)
      )
    }
    if (orderFilter === 'shortage') {
      result = result.filter(o => o.hasShortage)
    } else if (orderFilter === 'no-shortage') {
      result = result.filter(o => !o.hasShortage)
    }
    return result
  }, [eligibleOrders, orderSearch, orderFilter])

  const paginatedOrders = useMemo(() => {
    const start = (orderPage - 1) * orderPageSize
    return filteredEligibleOrders.slice(start, start + orderPageSize)
  }, [filteredEligibleOrders, orderPage])

  const orderTotalPages = Math.max(1, Math.ceil(filteredEligibleOrders.length / orderPageSize))

  const aggregatedItemsPreview = useMemo(() => {
    // The list endpoint does not carry per-order lines; the aggregate is
    // computed server-side when the batch is created from the order ids.
    return selectedOrderIds.map((orderId) => ({
      orderId,
      orderNumber: allOrders.find(o => o.id === orderId)?.orderNumber || '',
    }))
  }, [selectedOrderIds, allOrders])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (selectedOrderIds.length === 0) {
      setError('يجب اختيار طلب واحد على الأقل لربطه بالباتش.')
      return
    }
    const name = notes.trim()
    if (!name) {
      setError('يرجى إدخال ملاحظات الباتش.')
      return
    }

    setSaving(true)
    setError(null)
    try {
      await productionApi.createBatch({
        notes: name,
        startDate: startDate ? new Date(startDate).toISOString() : undefined,
        orderIds: selectedOrderIds,
      })
      navigate('/dashboard/production')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إنشاء الباتش.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <DashboardLayout navigate={navigate}>
      <div className="pb-container animate-fade-in">
        <header className="pb-page-header">
          <div>
            <p className="io-page-kicker">باتشات</p>
            <h1 className="pb-page-title">إنشاء باتش إنتاج</h1>
            <p className="pb-page-sub">أنشئ باتش تصنيع جديد باختيار الطلبات المرتبطة.</p>
          </div>
        </header>

        <div className="pb-body" style={{ gridTemplateColumns: '1fr' }}>
          <main className="pb-content">
            <div className="pb-module">
              {error && (
                <div style={{
                  background: 'var(--bg-secondary)', color: 'var(--text-muted)', padding: '0.75rem 1rem',
                  borderRadius: '8px', marginBottom: '1rem', border: '1px solid #66666640',
                  fontSize: '0.8rem', fontWeight: 500
                }}>
                  {error}
                </div>
              )}

              {loading ? (
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '200px' }}>
                  <div className="io-spinner" style={{ width: '28px', height: '28px', border: '3px solid var(--ss-sand)', borderTopColor: 'var(--ss-moss)', borderRadius: '50%', animation: 'io-spin 0.8s linear infinite' }} />
                </div>
              ) : (
                <form className="pb-multi-editor" onSubmit={handleSubmit}>
                  <div className="pb-multi-editor-full">
                    <span className="io-editor-kicker">سجل جديد</span>
                    <h3>إنشاء باتش إنتاج</h3>
                  </div>

                  <div className="pb-editor-field">
                    <label htmlFor="pb-notes">ملاحظات الباتش *</label>
                    <input id="pb-notes" className="pb-input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="مثال: دفعة بطانيات شتاء ٢٠٢٦" disabled={saving} required />
                  </div>

                  <div className="pb-editor-field">
                    <label htmlFor="pb-start">تاريخ البدء</label>
                    <input id="pb-start" type="date" className="pb-input" value={startDate} onChange={(e) => setStartDate(e.target.value)} disabled={saving} />
                  </div>

                  <div className="pb-multi-editor-full io-nested-form-section" style={{ marginTop: '1rem' }}>
                    <div style={{ marginBottom: '0.8rem' }}>
                      <strong>اختر الطلبات المتضمنة في الباتش *</strong>
                      <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.7rem', color: 'var(--ss-ink-soft)' }}>
                        اختر الطلبات التي سيتم ربطها لإنتاجها كباتش واحد.
                      </p>
                    </div>
                    <div style={{ marginBottom: '0.5rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <input className="pb-input" style={{ flex: 1, minHeight: '1.7rem', padding: '0.2rem 0.4rem', fontSize: '0.8rem' }} value={orderSearch} onChange={(e) => { setOrderSearch(e.target.value); setOrderPage(1) }} placeholder="بحث برقم الطلب أو اسم العميل..." />
                      <select className="pb-input" style={{ width: '130px', minHeight: '1.7rem', padding: '0.2rem 0.4rem', fontSize: '0.8rem' }} value={orderFilter} onChange={(e) => { setOrderFilter(e.target.value); setOrderPage(1) }}>
                        <option value="all">الكل</option>
                        <option value="shortage">عجز مخزون</option>
                        <option value="no-shortage">بدون عجز</option>
                      </select>
                    </div>
                    {filteredEligibleOrders.length === 0 ? (
                      <div style={{ border: '1px dashed var(--ss-line)', borderRadius: '10px', padding: '1.5rem', textAlign: 'center', color: 'var(--ss-ink-soft)', fontSize: '0.8rem' }}>
                        لا توجد طلبات متوفرة للجدولة حالياً.
                      </div>
                    ) : (
                      <>
                        <div style={{ maxHeight: '250px', overflowX: 'auto', overflowY: 'auto', border: '1px solid var(--ss-line)', borderRadius: '10px', padding: '0.5rem', background: 'var(--bg-primary)' }}>
                          {paginatedOrders.map((o) => {
                            const isChecked = selectedOrderIds.includes(o.id)
                            return (
                              <div key={o.id} style={{ display: 'flex', flexDirection: 'column', padding: '0.5rem', borderBottom: '1px solid #e6e6e6', background: isChecked ? 'var(--color-accent-contrast)' : 'transparent' }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600 }}>
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={(e) => {
                                      if (e.target.checked) {
                                        setSelectedOrderIds([...selectedOrderIds, o.id])
                                      } else {
                                        setSelectedOrderIds(selectedOrderIds.filter(id => id !== o.id))
                                      }
                                    }}
                                    disabled={saving}
                                  />
                                  <span style={{ fontFamily: 'monospace', color: 'var(--ss-terracotta)' }}>{o.orderNumber}</span>
                                  <span style={{ color: 'var(--ss-ink)' }}>| العميل: {o.customer.name}</span>
                                  <span style={{ color: 'var(--ss-ink-soft)', fontWeight: 400 }}>({o._count.items} أصناف)</span>
                                  {o.hasShortage && <span style={{ color: 'var(--ss-terracotta)', fontSize: '0.7rem', background: 'var(--bg-secondary)', padding: '0.1rem 0.35rem', borderRadius: '4px', fontWeight: 700 }}>⚠️ عجز مخزون</span>}
                                </label>
                              </div>
                            )
                          })}
                        </div>
                        {filteredEligibleOrders.length > orderPageSize && (
                          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.4rem', marginTop: '0.5rem', fontSize: '0.7rem' }}>
                            <button type="button" style={{ padding: '0.2rem 0.5rem', border: '1px solid var(--ss-line)', borderRadius: '4px', background: orderPage <= 1 ? 'var(--bg-secondary)' : 'var(--bg-primary)', color: orderPage <= 1 ? 'var(--text-muted)' : 'var(--text-primary)', cursor: orderPage <= 1 ? 'default' : 'pointer' }} disabled={orderPage <= 1} onClick={() => setOrderPage(p => p - 1)}>←</button>
                            <span>{toArabicNumerals(orderPage)} / {toArabicNumerals(orderTotalPages)}</span>
                            <button type="button" style={{ padding: '0.2rem 0.5rem', border: '1px solid var(--ss-line)', borderRadius: '4px', background: orderPage >= orderTotalPages ? 'var(--bg-secondary)' : 'var(--bg-primary)', color: orderPage >= orderTotalPages ? 'var(--text-muted)' : 'var(--text-primary)', cursor: orderPage >= orderTotalPages ? 'default' : 'pointer' }} disabled={orderPage >= orderTotalPages} onClick={() => setOrderPage(p => p + 1)}>→</button>
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  {selectedOrderIds.length > 0 && (
                    <div className="pb-multi-editor-full" style={{ marginTop: '0.5rem', background: 'var(--color-warning-soft)', border: '1px solid var(--ss-line)', padding: '0.8rem', borderRadius: '10px' }}>
                      <strong style={{ fontSize: '0.8rem', color: 'var(--ss-moss)' }}>📈 الكميات المجمعة للدفعة:</strong>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.5rem' }}>
                        {aggregatedItemsPreview.map((item, idx) => (
                          <span key={idx} style={{ background: 'var(--bg-primary)', border: '1px solid var(--ss-line)', borderRadius: 'var(--radius-md)', padding: '0.2rem 0.5rem', fontSize: '0.7rem', fontWeight: 600 }}>
                            {item.orderNumber}: طلب مرتبط بالدفعة
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="pb-multi-editor-full" style={{ display: 'flex', justifyContent: 'flex-start', gap: '0.5rem', marginTop: '0.8rem' }}>
                    <button type="button" className="io-button io-button-ghost" onClick={() => navigate('/dashboard/production')} disabled={saving}>إلغاء</button>
                    <button type="submit" className="io-button io-button-primary" disabled={saving}>{saving ? 'جاري الإنشاء...' : 'إنشاء الباتش'}</button>
                  </div>
                </form>
              )}
            </div>
          </main>
        </div>
      </div>
    </DashboardLayout>
  )
}
