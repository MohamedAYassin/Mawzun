import { useCallback, useEffect, useMemo, useState } from 'react'
import DashboardLayout from '../../components/DashboardLayout/DashboardLayout'
import { inventoryApi, type StockOperation, type Warehouse, type StockOperationStatus } from '../../lib/api'
import { toArabicNumerals } from '../../utils/arabicNumerals'
import '../../styles/DashboardViews.css'

export default function InventoryTransfers({ navigate }: { navigate: (path: string) => void }) {
  const [items, setItems] = useState<StockOperation[]>([])
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [transferTypeId, setTransferTypeId] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [fromWarehouseId, setFromWarehouseId] = useState('')
  const [toWarehouseId, setToWarehouseId] = useState('')
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const page = await inventoryApi.listStockOperations({ operationTypeId: transferTypeId || undefined, page: 1, pageSize: 10 })
      setItems(page.items)
    } catch {
      setNotice({ type: 'error', text: 'تعذر تحميل التحويلات.' })
    } finally {
      setLoading(false)
    }
  }, [transferTypeId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    Promise.all([inventoryApi.listWarehouses(), inventoryApi.listOperationTypes()])
      .then(([wh, types]) => {
        setWarehouses(wh)
        const transfer = types.find(t => (t.code || '').toUpperCase().includes('TRANS'))
        if (transfer) setTransferTypeId(transfer.id)
      })
      .catch(() => {})
  }, [])

  const statusLabel = useMemo(() => ({ DRAFT: 'جديدة', PENDING: 'قيد التنفيذ', READY: 'جاهزة', DONE: 'منفذة', CANCELLED: 'ملغاة' } as Record<StockOperationStatus, string>), [])

  const createTransfer = async () => {
    if (!transferTypeId || !fromWarehouseId || !toWarehouseId) {
      setNotice({ type: 'error', text: 'اختر نوع التحويل والمستودعين.' })
      return
    }
    if (fromWarehouseId === toWarehouseId) {
      setNotice({ type: 'error', text: 'مستودع المصدر والوجهة يجب أن يختلفا.' })
      return
    }
    setSaving(true)
    setNotice(null)
    try {
      await inventoryApi.createStockOperation({
        operationTypeId: transferTypeId,
        fromWarehouseId,
        toWarehouseId,
        reference: reference.trim() || 'تحويل مخزني',
        notes: notes.trim() || undefined,
        items: []
      })
      setNotice({ type: 'success', text: 'تم إنشاء التحويل. أضف الأصناف من شاشة حركات المخزون ثم نفّذه.' })
      setFormOpen(false)
      setReference(''); setNotes('')
      await load()
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'تعذر إنشاء التحويل.' })
    } finally {
      setSaving(false)
    }
  }

  const executeTransfer = async (id: string) => {
    if (!window.confirm('تنفيذ التحويل وخصم الكميات من المصدر وإضافتها للوجهة؟')) return
    try {
      await inventoryApi.executeStockOperation(id)
      setNotice({ type: 'success', text: 'تم تنفيذ التحويل بنجاح.' })
      await load()
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'تعذر تنفيذ التحويل.' })
    }
  }

  return (
    <DashboardLayout navigate={navigate}>
      <div className="view-container">
        <div className="view-header" style={{ marginBottom: '1.5rem' }}>
          <div>
            <h1 className="view-header-title">تحويلات المخزون</h1>
            <p className="view-header-subtitle">إنشاء ومتابعة تحويلات الكميات بين المستودعات وأماكن التخزين.</p>
          </div>
        </div>

        <div className="io-data-surface">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem 1rem', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)' }}>
            <strong style={{ fontSize: '0.85rem' }}>سجل التحويلات</strong>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button type="button" className="io-button io-button-ghost" onClick={() => void load()} disabled={loading}>تحديث</button>
              <button type="button" className="io-button io-button-primary" onClick={() => setFormOpen(o => !o)}>إضافة تحويل</button>
            </div>
          </div>

          {notice && <div style={{ padding: '0.5rem 1rem', fontSize: '0.8rem', background: notice.type === 'success' ? '#e6ffe6' : 'var(--color-danger-soft)' }}>{notice.text}</div>}

          {formOpen && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.7rem', padding: '0.9rem 1rem', borderBottom: '1px solid var(--border-color)' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.75rem', fontWeight: 700 }}>
                من مستودع
                <select value={fromWarehouseId} onChange={(e) => setFromWarehouseId(e.target.value)} style={{ padding: '0.45rem', border: '1px solid var(--border-color)', borderRadius: 6, background: 'var(--bg-primary)', color: 'var(--text-primary)', fontFamily: 'inherit' }}>
                  <option value="">اختر</option>
                  {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.75rem', fontWeight: 700 }}>
                الى مستودع
                <select value={toWarehouseId} onChange={(e) => setToWarehouseId(e.target.value)} style={{ padding: '0.45rem', border: '1px solid var(--border-color)', borderRadius: 6, background: 'var(--bg-primary)', color: 'var(--text-primary)', fontFamily: 'inherit' }}>
                  <option value="">اختر</option>
                  {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.75rem', fontWeight: 700 }}>
                المرجع
                <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="تحويل مخزني" style={{ padding: '0.45rem', border: '1px solid var(--border-color)', borderRadius: 6, background: 'var(--bg-primary)', color: 'var(--text-primary)', fontFamily: 'inherit' }} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.75rem', fontWeight: 700 }}>
                ملاحظات
                <input value={notes} onChange={(e) => setNotes(e.target.value)} style={{ padding: '0.45rem', border: '1px solid var(--border-color)', borderRadius: 6, background: 'var(--bg-primary)', color: 'var(--text-primary)', fontFamily: 'inherit' }} />
              </label>
              <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                <button type="button" className="io-button io-button-primary" onClick={() => void createTransfer()} disabled={saving} style={{ width: '100%' }}>
                  {saving ? 'جاري الإنشاء...' : 'إنشاء التحويل'}
                </button>
              </div>
            </div>
          )}

          {loading ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>جاري التحميل...</div>
          ) : (
            <div className="io-table-scroll ao-table-scroll">
              <table className="io-table">
                <thead><tr><th>#</th><th>رقم العملية</th><th>النوع</th><th>من</th><th>إلى</th><th>المرجع</th><th>الحالة</th><th>نُفذت في</th><th>إجراءات</th></tr></thead>
                <tbody>
                  {items.map((op, i) => (
                    <tr key={op.id}>
                      <td><span className="io-row-number">{toArabicNumerals(i + 1)}</span></td>
                      <td><span style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{op.operationNumber}</span></td>
                      <td><span>{op.operationType?.name ?? '—'}</span></td>
                      <td><span>{op.fromWarehouse?.name ?? '—'}</span></td>
                      <td><span>{op.toWarehouse?.name ?? '—'}</span></td>
                      <td><span>{op.reference || '—'}</span></td>
                      <td><span>{statusLabel[op.status] || op.status}</span></td>
                      <td><span>{op.executedAt ? new Date(op.executedAt).toLocaleDateString('ar-EG') : '—'}</span></td>
                      <td>
                        {op.status !== 'DONE' && op.status !== 'CANCELLED' && (
                          <button type="button" className="io-button io-button-ghost" onClick={() => void executeTransfer(op.id)}>تنفيذ</button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {items.length === 0 && (
                    <tr><td colSpan={5} style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--text-secondary)' }}>لا توجد تحويلات بعد.</td></tr>
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
