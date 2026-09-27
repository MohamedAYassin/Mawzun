import React, { useState, useEffect, useCallback, useMemo, type FormEvent } from 'react'
import DashboardLayout from '../../components/DashboardLayout/DashboardLayout'
import {
  productionApi,
  catalogApi,
  salesApi,
  type ProductionBatch,
  type ProductionBatchListItem,
  type ProductListItem,
  type OrderListItem,
  type ProductionBatchStatus,
} from '../../lib/api'
import { toArabicNumerals } from '../../utils/arabicNumerals'
import './Production.css'

interface ProductionProps {
  navigate: (path: string) => void
}

function ExpandedBatchDetail({ batchId, fallbackCount }: { batchId: string; fallbackCount: number }) {
  // The list row does not carry lines or orders; the full batch does.
  const [detail, setDetail] = useState<ProductionBatch | null>(null)
  useEffect(() => {
    let cancelled = false
    productionApi.getBatch(batchId).then((full) => {
      if (!cancelled) setDetail(full)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [batchId])

  return (
    <tr className="pb-expanded-row" style={{ background: 'var(--bg-canvas)' }}>
      <td colSpan={7} style={{ padding: '0' }}>
        <div className="pb-details-container animate-fade-in" style={{ padding: '1.25rem', borderRight: '4px solid var(--ss-terracotta)', borderBottom: '1px solid var(--ss-line)' }}>
          <div style={{ marginBottom: '1.25rem' }}>
            <h4 style={{ margin: '0 0 0.5rem 0', color: 'var(--ss-moss)', fontSize: '0.8rem' }}>
              <span>📦</span> إجمالي المواد المطلوبة للباتش ({toArabicNumerals(detail?.items.length ?? fallbackCount)} أصناف):
            </h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.5rem' }}>
              {(detail?.items ?? []).map((item: ProductionBatch['items'][number]) => (
                <div key={item.id} style={{ border: '1px solid var(--ss-line)', borderRadius: '8px', padding: '0.5rem 0.75rem', background: 'var(--bg-primary)' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.8rem', color: 'var(--ss-ink)' }}>{item.product.name}</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--ss-ink-soft)', marginTop: '0.25rem' }}>
                    <span>المستهدفة: <strong>{toArabicNumerals(item.quantity)}</strong></span>
                    <span>المنجزة: <strong style={{ color: item.producedQuantity === item.quantity ? '#67c23a' : 'inherit' }}>{toArabicNumerals(item.producedQuantity)}</strong></span>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div>
            <h4 style={{ margin: '0 0 0.65rem 0', color: 'var(--ss-moss)', fontSize: '0.8rem' }}>
              <span>📋</span> الطلبات المتضمنة:
            </h4>
            {(detail?.orders ?? []).length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', margin: 0, padding: '0.5rem', textAlign: 'center' }}>لا توجد طلبات مرتبطة بهذا الباتش.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                {(detail?.orders ?? []).map((order: ProductionBatch['orders'][number]) => (
                  <div key={order.id} style={{ border: '1px solid var(--ss-line)', borderRadius: '8px', padding: '0.8rem', background: 'var(--bg-primary)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e6e6e6', paddingBottom: '0.4rem', marginBottom: '0.4rem' }}>
                      <div>
                        <strong style={{ fontFamily: 'monospace', color: 'var(--ss-terracotta)', fontSize: '0.85rem' }}>{order.orderNumber}</strong>
                        <span style={{ fontSize: '0.8rem', color: 'var(--ss-ink-soft)', marginRight: '1rem' }}>العميل: {order.customer.name} ({order.customer.phoneNumber1})</span>
                      </div>
                      <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.7rem', background: 'var(--bg-secondary)', color: 'var(--ss-moss)', padding: '0.15rem 0.4rem', borderRadius: '4px', fontWeight: 600 }}>{order.status}</span>
                        {order.hasShortage && (
                          <span style={{ fontSize: '0.7rem', background: 'var(--bg-secondary)', color: 'var(--ss-terracotta)', border: '1px solid #cccccc', padding: '0.15rem 0.4rem', borderRadius: '4px', fontWeight: 700 }}>⚠️ عجز مخزون</span>
                        )}
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.4rem' }}>
                      {order._count.items} أصناف
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </td>
    </tr>
  )
}

type Notice = {
  type: 'success' | 'error' | 'info'
  text: string
}

const statusOptions = [
  { value: '', label: 'الكل' },
  { value: 'PLANNED', label: 'مخطط لها' },
  { value: 'IN_PROGRESS', label: 'قيد التشغيل' },
  { value: 'COMPLETED', label: 'مكتملة' },
  { value: 'CANCELLED', label: 'ملغاة' },
]

export default function ProductionPage({ navigate }: ProductionProps) {
  const [paginatedData, setPaginatedData] = useState<{ page: number; pageSize: number; totalPages: number; total: number; items: ProductionBatchListItem[] }>({ page: 1, pageSize: 20, totalPages: 0, total: 0, items: [] })
  const [products, setProducts] = useState<ProductListItem[]>([])
  const [allOrders, setAllOrders] = useState<OrderListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [notice, setNotice] = useState<Notice | null>(null)
  const [expandedBatchId, setExpandedBatchId] = useState<string | null>(null)

  // Edit form state
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<ProductionBatchListItem | null>(null)
  const [notes, setNotes] = useState('')
  const [startDate, setStartDate] = useState('')
  const [completionDate, setCompletionDate] = useState('')
  const [formStatus, setFormStatus] = useState<ProductionBatchStatus>('PLANNED')
  const [items, setItems] = useState<{ productId: string; quantity: number; producedQuantity: number; notes: string }[]>([])
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([])
  const [orderSearch, setOrderSearch] = useState('')
  const [orderFilter, setOrderFilter] = useState('all')
  const [orderPage, setOrderPage] = useState(1)
  const orderPageSize = 10

  const loadData = useCallback(async (page: number, search: string, status: string) => {
    setLoading(true)
    setNotice(null)
    try {
      const [paginated, productsRes, ordersRes] = await Promise.all([
        productionApi.listBatches({ page, pageSize: 10, search: search || undefined, status: status ? (status as ProductionBatchStatus) : undefined }),
        catalogApi.listProducts({ pageSize: 200, isActive: true }).catch(() => ({ items: [] as ProductListItem[] })),
        salesApi.listOrders({ type: 'SALE', pageSize: 200 }).catch(() => ({ items: [] as OrderListItem[] })),
      ])
      setPaginatedData({ page: paginated.page, pageSize: paginated.pageSize, totalPages: paginated.totalPages, total: paginated.total, items: paginated.items })
      setProducts(productsRes.items)
      setAllOrders(ordersRes.items)
    } catch {
      setNotice({ type: 'error', text: 'حدث خطأ أثناء تحميل بيانات التصنيع.' })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadData(1, '', '')
  }, [loadData])

  const eligibleOrders = useMemo(() => {
    return allOrders.filter(o =>
      o.status !== 'CANCELLED' &&
      o.status !== 'RETURNED'
    )
  }, [allOrders, editing])

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
    // The list endpoint does not carry per-order lines; the backend aggregates
    // the selected orders into batch lines when the batch is saved.
    return selectedOrderIds.map((orderId) => ({
      orderId,
      orderNumber: allOrders.find(o => o.id === orderId)?.orderNumber || '',
    }))
  }, [selectedOrderIds, allOrders])

  const goToPage = (page: number) => {
    void loadData(page, searchQuery, statusFilter)
  }

  const handleSearchChange = (value: string) => {
    setSearchQuery(value)
    void loadData(1, value, statusFilter)
  }

  const handleStatusChange = (value: string) => {
    setStatusFilter(value)
    void loadData(1, searchQuery, value)
  }

  const startEdit = (batch: ProductionBatchListItem) => {
    setEditing(batch)
    setNotes(batch.notes || '')
    setStartDate(batch.startDate ? new Date(batch.startDate).toISOString().substring(0, 10) : '')
    setFormStatus(batch.status)
    // The list row does not carry lines or orders; edits resubmit only what
    // the row shows, plus notes and dates.
    setItems([])
    setSelectedOrderIds([])
    setFormOpen(true)
    setNotice(null)
  }

  const updateItemRow = (index: number, key: string, val: any) => {
    const updated = [...items]
    updated[index] = { ...updated[index], [key]: val }
    setItems(updated)
  }

  const closeForm = () => {
    setFormOpen(false)
    setEditing(null)
    setNotes('')
    setStartDate('')
    setCompletionDate('')
    setFormStatus('PLANNED')
    setItems([])
    setSelectedOrderIds([])
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!editing) return
    if (selectedOrderIds.length === 0) {
      setNotice({ type: 'error', text: 'يجب اختيار طلب واحد على الأقل لربطه بالباتش.' })
      return
    }

    setSaving(true)
    setNotice(null)
    try {
      await productionApi.updateBatch(editing.id, {
        notes: notes.trim(),
        startDate: startDate ? new Date(startDate).toISOString() : null,
        status: formStatus,
        orderIds: selectedOrderIds,
        items: items.map((i) => ({
          productId: i.productId,
          quantity: i.quantity,
          notes: i.notes.trim(),
        })),
      })
      setNotice({ type: 'success', text: 'تم تحديث الباتش بنجاح.' })
      closeForm()
      void loadData(paginatedData.page, searchQuery, statusFilter)
    } catch (err) {
      setNotice({ type: 'error', text: err instanceof Error ? err.message : 'تعذر حفظ السجل.' })
    } finally {
      setSaving(false)
    }
  }

  const removeBatch = async (batch: ProductionBatchListItem) => {
    if (!window.confirm(`هل أنت متأكد من حذف الباتش «${batch.batchNumber}»؟`)) return
    setSaving(true)
    try {
      await productionApi.deleteBatch(batch.id)
      setNotice({ type: 'success', text: 'تم حذف الباتش بنجاح.' })
      void loadData(paginatedData.page, searchQuery, statusFilter)
    } catch (err) {
      setNotice({ type: 'error', text: err instanceof Error ? err.message : 'تعذر حذف الباتش.' })
    } finally {
      setSaving(false)
    }
  }

  const quickStatusChange = async (batch: ProductionBatchListItem, newStatus: ProductionBatchStatus) => {
    if (newStatus === 'CANCELLED' && !window.confirm(`هل أنت متأكد من إلغاء الباتش «${batch.batchNumber}»؟`)) return
    setSaving(true)
    try {
      // Transitions are explicit endpoints, not free status assignment.
      if (newStatus === 'IN_PROGRESS') await productionApi.startBatch(batch.id)
      else if (newStatus === 'COMPLETED') await productionApi.completeBatch(batch.id)
      else if (newStatus === 'CANCELLED') await productionApi.cancelBatch(batch.id)
      setNotice({ type: 'success', text: 'تم تحديث حالة الباتش.' })
      void loadData(paginatedData.page, searchQuery, statusFilter)
    } catch (err) {
      setNotice({ type: 'error', text: err instanceof Error ? err.message : 'تعذر تحديث الحالة.' })
    } finally {
      setSaving(false)
    }
  }

  const getStatusBadgeClass = (status: ProductionBatchStatus) => {
    switch (status) {
      case 'PLANNED': return 'pb-status-planned'
      case 'IN_PROGRESS': return 'pb-status-inprogress'
      case 'COMPLETED': return 'pb-status-completed'
      case 'CANCELLED': return 'pb-status-cancelled'
      default: return ''
    }
  }

  const { page, totalPages, total: totalEntries, items: batches } = paginatedData

  return (
    <DashboardLayout navigate={navigate}>
      <div className="pb-container animate-fade-in">
        <header className="pb-page-header">
          <div>
            <p className="io-page-kicker">باتشات</p>
            <h1 className="pb-page-title">إدارة الباتشات</h1>
            <p className="pb-page-sub">خطط وجدولة باتشات التصنيع بناءً على الطلبات، وتابع حالة الإنتاج، وعجز المخزون لكل طلب.</p>
          </div>
        </header>

        <div className="pb-body" style={{ gridTemplateColumns: '1fr' }}>
          <main className="pb-content">
            <div className="pb-module">
              <div className="pb-module-heading">
                <div>
                  <h2>الباتشات</h2>
                  <p>جدولة ومتابعة باتشات التصنيع الحالية والمستقبلية.</p>
                </div>
              </div>

              <div className="pb-module-actions" style={{ marginTop: '0.85rem' }}>
                <span className="pb-count-chip"><strong>{toArabicNumerals(totalEntries)}</strong> باتشات</span>
                <button className="io-button io-button-ghost" onClick={() => void loadData(page, searchQuery, statusFilter)} disabled={loading || saving}>تحديث</button>
              </div>

              {notice && (
                <div style={{
                  background: notice.type === 'success' ? 'var(--bg-secondary)' : 'var(--bg-secondary)',
                  color: notice.type === 'success' ? '#67c23a' : 'var(--text-muted)',
                  padding: '0.75rem 1rem', borderRadius: '8px', marginBottom: '1rem',
                  border: `1px solid ${notice.type === 'success' ? '#67c23a' : 'var(--text-muted)'}40`,
                  fontSize: '0.8rem', fontWeight: 500
                }}>
                  {notice.text}
                </div>
              )}

              <div className="io-list-toolbar">
                <label className="pb-search">
                  <input value={searchQuery} onChange={(e) => handleSearchChange(e.target.value)} placeholder="البحث برقم الباتش أو الملاحظات..." aria-label="البحث في الباتشات" />
                </label>
                <select className="pb-input" style={{ width: '160px' }} value={statusFilter} onChange={(e) => handleStatusChange(e.target.value)}>
                  {statusOptions.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              {formOpen && editing && (
                <form className="pb-multi-editor" onSubmit={submit}>
                  <div className="pb-multi-editor-full">
                    <span className="io-editor-kicker">تعديل السجل</span>
                    <h3>تعديل باتش: {editing.batchNumber}</h3>
                  </div>

                  <div className="pb-editor-field">
                    <label htmlFor="pb-notes">ملاحظات الباتش *</label>
                    <input id="pb-notes" className="pb-input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="مثال: دفعة بطانيات شتاء ٢٠٢٦" disabled={saving} required />
                  </div>

                  <div className="pb-editor-field">
                    <label htmlFor="pb-start">تاريخ البدء</label>
                    <input id="pb-start" type="date" className="pb-input" value={startDate} onChange={(e) => setStartDate(e.target.value)} disabled={saving} />
                  </div>

                  <div className="pb-editor-field">
                    <label htmlFor="pb-completion">تاريخ الانتهاء</label>
                    <input id="pb-completion" type="date" className="pb-input" value={completionDate} onChange={(e) => setCompletionDate(e.target.value)} disabled={saving} />
                  </div>

                  <div className="pb-editor-field pb-multi-editor-full">
                    <label htmlFor="pb-status">حالة الباتش</label>
                    <select id="pb-status" className="pb-input" value={formStatus} onChange={(e) => setFormStatus(e.target.value as ProductionBatchStatus)} disabled={saving}>
                      <option value="PLANNED">مخطط لها</option>
                      <option value="IN_PROGRESS">قيد التشغيل</option>
                      <option value="COMPLETED">مكتملة</option>
                      <option value="CANCELLED">ملغاة</option>
                    </select>
                  </div>

                  <div className="pb-multi-editor-full io-nested-form-section" style={{ marginTop: '1rem' }}>
                    <div style={{ marginBottom: '0.8rem' }}>
                      <strong>اختر الطلبات المتضمنة في الباتش *</strong>
                      <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.7rem', color: 'var(--ss-ink-soft)' }}>اختر الطلبات التي سيتم ربطها لإنتاجها كباتش واحد.</p>
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
                        <div style={{ maxHeight: '200px', overflowX: 'auto', overflowY: 'auto', border: '1px solid var(--ss-line)', borderRadius: '10px', padding: '0.5rem', background: 'var(--bg-primary)' }}>
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
                            <button type="button" style={{ padding: '0.2rem 0.5rem', border: '1px solid var(--ss-line)', borderRadius: '4px', background: orderPage <= 1 ? 'var(--bg-secondary)' : 'var(--color-accent-contrast)', color: orderPage <= 1 ? '#bbb' : '#333', cursor: orderPage <= 1 ? 'default' : 'pointer' }} disabled={orderPage <= 1} onClick={() => setOrderPage(p => p - 1)}>←</button>
                            <span>{toArabicNumerals(orderPage)} / {toArabicNumerals(orderTotalPages)}</span>
                            <button type="button" style={{ padding: '0.2rem 0.5rem', border: '1px solid var(--ss-line)', borderRadius: '4px', background: orderPage >= orderTotalPages ? 'var(--bg-secondary)' : 'var(--color-accent-contrast)', color: orderPage >= orderTotalPages ? '#bbb' : '#333', cursor: orderPage >= orderTotalPages ? 'default' : 'pointer' }} disabled={orderPage >= orderTotalPages} onClick={() => setOrderPage(p => p + 1)}>→</button>
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

                  {editing && items.length > 0 && (
                    <div className="pb-multi-editor-full io-nested-form-section" style={{ marginTop: '1rem' }}>
                      <div style={{ marginBottom: '0.5rem' }}>
                        <strong>سجل تقدم إنتاج الأصناف:</strong>
                        <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.7rem', color: 'var(--ss-ink-soft)' }}>
                          حدّث الكميات التي تم الانتهاء من تصنيعها فعلياً لتسجيلها في النظام.
                        </p>
                      </div>
                      {items.map((it, idx) => {
                        const pName = products.find(p => p.id === it.productId)?.name || 'صنف غير معروف'
                        return (
                          <div className="io-nested-row" key={idx} style={{ borderBottom: '1px solid #e6e6e6', paddingBottom: '0.5rem', marginBottom: '0.5rem' }}>
                            <div style={{ flex: 2 }}>
                              <label style={{ fontSize: '0.7rem', color: 'var(--ss-ink-soft)' }}>المنتج</label>
                              <div style={{ fontSize: '0.8rem', fontWeight: 600, padding: '0.25rem 0' }}>{pName}</div>
                            </div>
                            <div style={{ flex: 1 }}>
                              <label style={{ fontSize: '0.7rem', color: 'var(--ss-ink-soft)' }}>المستهدفة</label>
                              <div style={{ fontSize: '0.8rem', fontWeight: 600, padding: '0.25rem 0' }}>{toArabicNumerals(it.quantity)}</div>
                            </div>
                            <div style={{ flex: 1 }}>
                              <label style={{ fontSize: '0.7rem', color: 'var(--ss-ink-soft)' }}>المنتجة فعلياً</label>
                              <input type="number" className="pb-input" style={{ minHeight: '1.7rem', padding: '0.2rem 0.4rem', fontSize: '0.8rem' }} value={it.producedQuantity} onChange={(e) => updateItemRow(idx, 'producedQuantity', Number(e.target.value))} disabled={saving} />
                            </div>
                            <div style={{ flex: 1.5 }}>
                              <label style={{ fontSize: '0.7rem', color: 'var(--ss-ink-soft)' }}>ملاحظات</label>
                              <input className="pb-input" style={{ minHeight: '1.7rem', padding: '0.2rem 0.4rem', fontSize: '0.8rem' }} value={it.notes} onChange={(e) => updateItemRow(idx, 'notes', e.target.value)} placeholder="ملاحظة تقدم الصنف" disabled={saving} />
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}

                  <div className="pb-multi-editor-full" style={{ display: 'flex', justifyContent: 'flex-start', gap: '0.5rem', marginTop: '0.8rem' }}>
                    <button type="button" className="io-button io-button-ghost" onClick={closeForm} disabled={saving}>إلغاء</button>
                    <button type="submit" className="io-button io-button-primary" disabled={saving}>{saving ? 'جاري الحفظ...' : 'حفظ الباتش'}</button>
                  </div>
                </form>
              )}

              <div className="pb-data-surface">
                {loading ? (
                  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '150px' }}>
                    <div className="io-spinner" style={{ width: '28px', height: '28px', border: '3px solid var(--ss-sand)', borderTopColor: 'var(--ss-moss)', borderRadius: '50%', animation: 'io-spin 0.8s linear infinite' }} />
                  </div>
                ) : batches.length === 0 ? (
                  <div className="io-empty-state">
                    <div className="io-empty-mark"><span>📁</span></div>
                    <h3>لا توجد باتشات</h3>
                    <p>{searchQuery || statusFilter ? 'لا توجد نتائج تطابق بحثك حالياً.' : 'ابدأ بإضافة أول باتش للنظام الآن.'}</p>
                  </div>
                ) : (
                   <div className="io-table-scroll">
                  <table className="pb-table">
                    <thead>
                      <tr>
                        <th>رقم الباتش</th>
                        <th>تاريخ البدء</th>
                        <th>تاريخ الانتهاء</th>
                        <th>أُلغيت في</th>
                        <th>الملاحظات</th>
                        <th>الطلبات المتضمنة</th>
                        <th>الحالة</th>
                        <th style={{ direction: 'ltr', textAlign: 'center' }}>الإجراءات</th>
                      </tr>
                    </thead>
                    <tbody>
                      {batches.map((b) => {
                        const isExpanded = expandedBatchId === b.id
                        return (
                          <React.Fragment key={b.id}>
                            <tr
                              style={{ cursor: 'pointer', background: isExpanded ? '#fbf8f5' : undefined }}
                              onClick={() => setExpandedBatchId(isExpanded ? null : b.id)}
                            >
                              <td>
                                <span style={{ marginRight: '6px', fontSize: '0.7rem', color: 'var(--text-muted)' }}>{isExpanded ? '▼' : '▶'}</span>
                                <strong style={{ fontFamily: 'monospace' }}>{b.batchNumber}</strong>
                              </td>
                              <td><span>{b.startDate ? new Date(b.startDate).toLocaleDateString('ar-EG') : 'غير محدد'}</span></td>
                              <td><span>{b.completionDate ? new Date(b.completionDate).toLocaleDateString('ar-EG') : '—'}</span></td>
                              <td><span>{b.cancelledAt ? new Date(b.cancelledAt).toLocaleDateString('ar-EG') : '—'}</span></td>
                              <td><span>{b.notes || '—'}</span></td>
                              <td>
                                <span className="io-related-badge" style={{ background: 'var(--bg-secondary)' }}>
                                  {toArabicNumerals(b._count.orders)} طلبات
                                </span>
                              </td>
                              <td>
                                <span className={`pb-status-badge ${getStatusBadgeClass(b.status)}`}>
                                {b.status === 'PLANNED' ? 'مخطط لها' : b.status === 'IN_PROGRESS' ? 'قيد التشغيل' : b.status === 'COMPLETED' ? 'مكتملة' : 'ملغاة'}
                                </span>
                              </td>
                              <td style={{ textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
                                <div className="pb-row-actions">
                                  <button className={`pb-quick-btn ${b.status === 'PLANNED' ? 'pb-quick-btn-active pb-quick-btn-planned' : ''}`} onClick={() => void quickStatusChange(b, 'PLANNED')}>مخطط</button>
                                  <button className={`pb-quick-btn ${b.status === 'IN_PROGRESS' ? 'pb-quick-btn-active pb-quick-btn-inprogress' : ''}`} onClick={() => void quickStatusChange(b, 'IN_PROGRESS')}>تشغيل</button>
                                  <button className={`pb-quick-btn ${b.status === 'COMPLETED' ? 'pb-quick-btn-active pb-quick-btn-completed' : ''}`} onClick={() => void quickStatusChange(b, 'COMPLETED')}>مكتمل</button>
                                  <button className={`pb-quick-btn ${b.status === 'CANCELLED' ? 'pb-quick-btn-active pb-quick-btn-cancelled' : ''}`} onClick={() => void quickStatusChange(b, 'CANCELLED')}>ملغي</button>
                                  <button className="pb-quick-btn pb-quick-btn-edit" onClick={() => startEdit(b)}>تعديل</button>
                                  <button className="pb-quick-btn pb-quick-btn-delete" onClick={() => void removeBatch(b)}>حذف</button>
                                </div>
                              </td>
                            </tr>

                            {isExpanded && (
                              <ExpandedBatchDetail batchId={b.id} fallbackCount={b._count.items} />
                            )}
                          </React.Fragment>
                        )
                      })}
                    </tbody>
                  </table>
                   </div>
                )}
              </div>

              {totalPages > 1 && (
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem', paddingTop: '1rem', borderTop: '1px solid var(--ss-line)', marginTop: '1rem' }}>
                  <button onClick={() => goToPage(page - 1)} disabled={page <= 1} style={{
                    padding: '0.4rem 0.9rem', border: '1px solid var(--ss-line)', borderRadius: 'var(--radius-md)',
                    background: page <= 1 ? 'var(--bg-secondary)' : 'var(--bg-primary)',
                    color: page <= 1 ? 'var(--text-muted)' : 'var(--text-primary)',
                    cursor: page <= 1 ? 'default' : 'pointer', fontSize: '0.8rem', fontWeight: 600
                  }}>
                    ← السابق
                  </button>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    الصفحة {toArabicNumerals(page)} من {toArabicNumerals(totalPages)} ({toArabicNumerals(totalEntries)} باتش)
                  </span>
                  <button onClick={() => goToPage(page + 1)} disabled={page >= totalPages} style={{
                    padding: '0.4rem 0.9rem', border: '1px solid var(--ss-line)', borderRadius: 'var(--radius-md)',
                    background: page >= totalPages ? 'var(--bg-secondary)' : 'var(--bg-primary)',
                    color: page >= totalPages ? 'var(--text-muted)' : 'var(--text-primary)',
                    cursor: page >= totalPages ? 'default' : 'pointer', fontSize: '0.8rem', fontWeight: 600
                  }}>
                    التالي →
                  </button>
                </div>
              )}
            </div>
          </main>
        </div>
      </div>
    </DashboardLayout>
  )
}
