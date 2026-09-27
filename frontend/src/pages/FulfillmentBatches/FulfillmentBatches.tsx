import { useCallback, useEffect, useState, type FormEvent } from 'react'
import DashboardLayout from '../../components/DashboardLayout/DashboardLayout'
import { salesApi, inventoryApi, type FulfillmentBatch, type Warehouse, type FulfillmentBatchStatus, type FulfillmentBatchType } from '../../lib/api'
import { ModuleHeading, StatusBanner, ListToolbar, LoadingState, EmptyState, EditorHeader, EditorActions, Button, BoxIcon, type Notice } from '../shared/ManagementUi'
import '../SystemSettings/SystemSettings.css'

export interface FulfillmentBatchesProps {
  navigate: (path: string) => void
  kind: 'picking' | 'packing'
}

const BATCH_STATUS_LABELS: Record<FulfillmentBatchStatus, string> = {
  NEW: 'جديدة',
  DONE: 'مكتملة',
  CANCELLED: 'ملغاة'
}

function FulfillmentBatchesTab(kind: 'picking' | 'packing') {
  const type: FulfillmentBatchType = kind === 'packing' ? 'PACKING' : 'PICKING'
  const [items, setItems] = useState<FulfillmentBatch[]>([])
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<FulfillmentBatchStatus | ''>('')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [totalEntries, setTotalEntries] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [warehouseId, setWarehouseId] = useState('')
  const [notice, setNotice] = useState<Notice | null>(null)
  const [lastLoaded, setLastLoaded] = useState<Date | null>(null)

  const load = useCallback(async (showLoader = true, currentPage = page, currentStatus = statusFilter) => {
    if (showLoader) setLoading(true)
    try {
      const result = await salesApi.listFulfillmentBatches({ type, status: currentStatus || undefined, search: query || undefined, page: currentPage, pageSize: 10 })
      setItems(result.items)
      setTotalPages(result.totalPages)
      setTotalEntries(result.total)
      setLastLoaded(new Date())
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'تعذر تحميل الدفعات.' })
    } finally { setLoading(false) }
  }, [type, query, page, statusFilter])

  const loadWarehouses = useCallback(async () => {
    try {
      setWarehouses(await inventoryApi.listWarehouses())
    } catch {
      /* warehouse list failures surface on submit */
    }
  }, [])

  useEffect(() => { void load(); void loadWarehouses() }, [load, loadWarehouses])

  const startAdd = () => { setFormOpen(true); setWarehouseId(''); setNotice(null) }
  const closeForm = () => { setFormOpen(false); setWarehouseId('') }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!warehouseId) { setNotice({ type: 'error', text: 'يرجى اختيار المستودع.' }); return }
    setSaving(true); setNotice(null)
    try {
      // The batch name is required by the backend and unique per warehouse, so
      // it is stamped with the time rather than asked of the user.
      const name = `${kind === 'packing' ? 'تغليف' : 'تجهيز'} ${new Date().toLocaleDateString('ar-EG')} ${new Date().toLocaleTimeString('ar-EG')}`.slice(0, 60)
      await salesApi.createFulfillmentBatch({ warehouseId, type, name })
      setNotice({ type: 'success', text: 'تم إنشاء الدفعة بنجاح.' })
      closeForm(); await load(false)
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'تعذر إنشاء الدفعة.' })
    } finally { setSaving(false) }
  }

  const changeStatus = async (item: FulfillmentBatch, status: FulfillmentBatchStatus) => {
    setSaving(true); setNotice(null)
    try {
      // The backend exposes complete and cancel transitions, not free status
      // assignment — and neither is reversible from here.
      if (status === 'DONE') await salesApi.completeFulfillmentBatch(item.id)
      else if (status === 'CANCELLED') await salesApi.cancelFulfillmentBatch(item.id)
      setNotice({ type: 'success', text: 'تم تحديث حالة الدفعة.' })
      await load(false)
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'تعذر تحديث الحالة.' })
    } finally { setSaving(false) }
  }

  const applyStatusFilter = (next: FulfillmentBatchStatus | '') => {
    setStatusFilter(next)
    setPage(1)
    void load(true, 1, next)
  }

  const goToPage = (next: number) => {
    setPage(next)
    void load(true, next, statusFilter)
  }

  return { items, warehouses, query, setQuery, statusFilter, applyStatusFilter, page, totalPages, totalEntries, loading, saving, formOpen, warehouseId, setWarehouseId, notice, lastLoaded, load, startAdd, closeForm, submit, changeStatus, goToPage }
}

function FulfillmentBatchesView({ kind }: { kind: 'picking' | 'packing' }) {
  const t = FulfillmentBatchesTab(kind)
  const isPicking = kind === 'picking'
  return (
    <section className="ss-module animate-fade-in">
      <ModuleHeading
        icon={<BoxIcon />}
        eyebrow="العمليات"
        title={isPicking ? 'قوائم التجهيز (Picking)' : 'قوائم التغليف (Packing)'}
        subtitle={isPicking ? 'دفعات تجهيز الطلبات من أرفف المستودعات قبل التغليف.' : 'دفعات تغليف الطلبات المؤمنة وتجهيزها للشحن.'}
      />
      <div className="ss-module-actions">
        <span className="ss-count-chip"><strong>{t.totalEntries}</strong> دفعة</span>
        <Button variant="ghost" onClick={() => void t.load()} disabled={t.loading || t.saving}>تحديث</Button>
        <Button onClick={t.startAdd} disabled={t.saving}>دفعة جديدة</Button>
      </div>
      <StatusBanner notice={t.notice} />
      <div className="ss-list-toolbar">
        <ListToolbar query={t.query} setQuery={t.setQuery} placeholder="ابحث برقم الدفعة..." lastLoaded={t.lastLoaded} />
        <label className="ss-search" style={{ minWidth: '150px' }}>
          <span>الحالة:</span>
          <select value={t.statusFilter} onChange={(event) => t.applyStatusFilter(event.target.value as FulfillmentBatchStatus | '')} aria-label="تصفية بالحالة" className="ss-input">
            <option value="">الكل</option>
            {Object.entries(BATCH_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
      </div>
      {t.formOpen && (
        <form className="ss-multi-editor" onSubmit={t.submit}>
          <EditorHeader editing={false} singular="دفعة" />
          <div className="ss-editor-field">
            <label htmlFor="batch-warehouse">المستودع</label>
            <select id="batch-warehouse" className="ss-input" value={t.warehouseId} onChange={(event) => t.setWarehouseId(event.target.value)} disabled={t.saving}>
              <option value="">— اختر المستودع —</option>
              {t.warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
            </select>
          </div>
          <EditorActions closeForm={t.closeForm} saving={t.saving} editing={false} />
        </form>
      )}
      <div className="ss-data-surface">
        {t.loading ? <LoadingState /> : t.items.length === 0 ? <EmptyState hasSearch={Boolean(t.query.trim())} /> : (
          <div className="ss-table-scroll">
            <table className="ss-table">
              <thead><tr><th>#</th><th>رقم الدفعة</th><th>المستودع</th><th>النوع</th><th>الحالة</th><th>أُنشئت في</th><th>اكتملت في</th><th className="ss-actions-column">الإجراءات</th></tr></thead>
              <tbody>
                {t.items.map((item, index) => (
                  <tr key={item.id}>
                    <td><span className="ss-row-number">{(t.page - 1) * 10 + index + 1}</span></td>
                    <td><span className="ss-item-name" dir="ltr">{item.name}</span></td>
                    <td><span>{item.warehouse.name}</span></td>
                    <td>{item.type === 'PACKING' ? 'تغليف' : 'التقاط'}</td>
                    <td>
                      <select
                        className="ss-input"
                        value={item.status}
                        onChange={(event) => void t.changeStatus(item, event.target.value as FulfillmentBatchStatus)}
                        disabled={t.saving}
                        aria-label={`حالة ${item.name}`}
                        style={{ minWidth: '110px', padding: '0.25rem 0.5rem' }}
                      >
                        {Object.entries(BATCH_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                    </td>
                    <td><span>{new Date(item.createdAt).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' })}</span></td>
                    <td><span>{item.completedAt ? new Date(item.completedAt).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' }) : '—'}</span></td>
                    <td className="ss-actions-column" />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {t.totalPages > 1 && (
        <div className="ss-list-toolbar" style={{ justifyContent: 'center' }}>
          <Button variant="ghost" onClick={() => t.goToPage(t.page - 1)} disabled={t.page <= 1 || t.loading}>السابق</Button>
          <span className="ss-count-chip">صفحة {t.page} من {t.totalPages}</span>
          <Button variant="ghost" onClick={() => t.goToPage(t.page + 1)} disabled={t.page >= t.totalPages || t.loading}>التالي</Button>
        </div>
      )}
    </section>
  )
}

export default function FulfillmentBatches({ navigate, kind }: FulfillmentBatchesProps) {
  return (
    <DashboardLayout navigate={navigate}>
      <div className="view-container">
        <FulfillmentBatchesView kind={kind} />
      </div>
    </DashboardLayout>
  )
}
