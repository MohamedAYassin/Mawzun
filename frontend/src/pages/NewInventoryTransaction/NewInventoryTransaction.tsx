import { useEffect, useState, type FormEvent } from 'react'
import DashboardLayout from '../../components/DashboardLayout/DashboardLayout'
import { Select } from '../../components/Select/Select'
import {
  inventoryApi,
  catalogApi,
  type ProductListItem,
  type StorageLocation,
} from '../../lib/api'
import { useCurrentUser } from '../../hooks/useCurrentUser'
import '../../styles/DashboardViews.css'

type Notice = {
  type: 'success' | 'error' | 'info'
  text: string
}


function StatusBanner({ notice }: { notice: Notice | null }) {
  if (!notice) return null
  return (
    <div style={{ padding: '0.5rem 1rem', fontSize: '0.8rem', background: notice.type === 'success' ? '#e6ffe6' : notice.type === 'error' ? 'var(--color-danger-soft)' : '#e6f3ff', borderBottom: '1px solid var(--border-color)' }}>
      {notice.text}
    </div>
  )
}

export default function NewInventoryTransaction({ navigate }: { navigate: (path: string) => void }) {
  const [products, setProducts] = useState<ProductListItem[]>([])
  const [locations, setLocations] = useState<StorageLocation[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)

  const [productId, setProductId] = useState('')
  const [storageLocationId, setStorageLocationId] = useState('')
  const [destLocationId, setDestLocationId] = useState('')
  const [transactionType, setTransactionType] = useState<'IN' | 'OUT' | 'TRANSFER' | 'ADJUSTMENT'>('IN')
  const [quantity, setQuantity] = useState('')
  const [referenceNumber, setReferenceNumber] = useState('')
  const [reason, setReason] = useState('')

  const { hasPermission } = useCurrentUser()
  const hasManage = hasPermission('Permissions.ManageInventory')

  useEffect(() => {
    async function init() {
      try {
        const productsPage = await catalogApi.listProducts({ pageSize: 200 }).catch(() => null)
        const lRes = await inventoryApi.listStorageLocations().catch(() => [])
        setProducts(productsPage ? productsPage.items : [])
        setLocations(lRes)
        if (productsPage && productsPage.items[0]) setProductId(productsPage.items[0].id)
        if (lRes[0]) {
          setStorageLocationId(lRes[0].id)
          setDestLocationId(lRes[0].id)
        }
      } catch {
        // silent
      } finally {
        setLoading(false)
      }
    }
    void init()
  }, [])

  const resetForm = () => {
    setProductId(products[0]?.id || '')
    setStorageLocationId(locations[0]?.id || '')
    setDestLocationId(locations[0]?.id || '')
    setTransactionType('IN')
    setQuantity('')
    setReferenceNumber('')
    setReason('')
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const numQty = Number(quantity)
    if (!productId || !storageLocationId || !quantity || numQty <= 0) {
      setNotice({ type: 'error', text: 'يرجى إدخال الحقول الأساسية: المنتج، مكان التخزين، والكمية أكبر من صفر.' })
      return
    }

    setSaving(true)
    setNotice(null)
    try {
      if (transactionType === 'TRANSFER') {
        if (!destLocationId || destLocationId === storageLocationId) {
          setNotice({ type: 'error', text: 'يرجى اختيار موقع وجهة مختلف لإجراء عملية التحويل.' })
          setSaving(false)
          return
        }

        // One call moves the stock; the backend writes both legs of the
        // transfer and refuses to go negative at the source.
        await inventoryApi.transferStock({
          productId,
          fromStorageLocationId: storageLocationId,
          toStorageLocationId: destLocationId,
          quantity: numQty,
          reason: reason.trim() || null,
        })

        setNotice({ type: 'success', text: 'تمت عملية التحويل المخزني بنجاح.' })
      } else {
        // IN/OUT/ADJUSTMENT all end as a corrected count at one location, so
        // the current balance is read first and the movement applied to it.
        const levels = await inventoryApi.listStockLevels({ productId, storageLocationId, pageSize: 1 })
        const onHand = levels.items[0]?.onHand ?? 0
        const counted = transactionType === 'IN' ? onHand + numQty : transactionType === 'OUT' ? onHand - numQty : numQty
        await inventoryApi.adjustStock({
          productId,
          storageLocationId,
          countedQuantity: counted,
          reason: reason.trim() || null,
        })
        setNotice({ type: 'success', text: 'تم تسجيل الحركة وتحديث رصيد المخزن بنجاح.' })
      }
      resetForm()
    } catch (e) {
      setNotice({ type: 'error', text: e instanceof Error ? e.message : 'فشلت الحركة المخزنية. تحقق من توفر الرصيد الكافي.' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <DashboardLayout navigate={navigate}>
      <div className="view-container">
        <div className="view-header" style={{ marginBottom: '1.5rem' }}>
          <div>
            <h1 className="view-header-title">تسجيل حركة مخزنية</h1>
            <p className="view-header-subtitle">إدخال بضائع واردة، صادر مبيعات، تحويل مخزني، أو تسوية جردية.</p>
          </div>
        </div>

        <div className="io-data-surface">
          <StatusBanner notice={notice} />

          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '150px', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
              جاري التحميل...
            </div>
          ) : (
            <form className="ss-multi-editor" onSubmit={submit}>
              <div className="ss-multi-editor-full">
                <span className="ss-editor-kicker">سجل حركة مخزنية</span>
                <h3>إضافة حركة أو تحويل</h3>
              </div>

              <div className="ss-editor-field">
                <label>المنتج *</label>
                <Select value={productId} onChange={setProductId} options={products.map(p => ({ value: p.id, label: `${p.name} (${p.skuCode})` }))} disabled={saving} placeholder="اختر المنتج" />
              </div>

              <div className="ss-editor-field">
                <label>نوع الحركة *</label>
                <Select value={transactionType} onChange={setTransactionType} options={[
                  { value: 'IN', label: 'وارد (زيادة رصيد)' },
                  { value: 'OUT', label: 'صادر (سحب رصيد)' },
                  { value: 'TRANSFER', label: 'تحويل مخزني' },
                  { value: 'ADJUSTMENT', label: 'تسوية جردية' },
                ]} disabled={saving} />
              </div>

              <div className="ss-editor-field">
                <label>{transactionType === 'TRANSFER' ? 'موقع المصدر *' : 'موقع التخزين *'}</label>
                <Select value={storageLocationId} onChange={setStorageLocationId} options={locations.map(loc => ({ value: loc.id, label: `${loc.name} (${loc.warehouse.name})` }))} disabled={saving} placeholder="اختر الموقع" />
              </div>

              {transactionType === 'TRANSFER' ? (
                <div className="ss-editor-field">
                  <label>موقع الوجهة *</label>
                  <Select value={destLocationId} onChange={setDestLocationId} options={locations.map(loc => ({ value: loc.id, label: `${loc.name} (${loc.warehouse.name})` }))} disabled={saving} placeholder="اختر موقع الوجهة" />
                </div>
              ) : (
                <div className="ss-editor-field">
                  <label htmlFor="tx-ref">رقم المرجع / الفاتورة</label>
                  <input id="tx-ref" className="ss-input" value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)} placeholder="مثال: Inv-10029" disabled={saving} />
                </div>
              )}

              <div className="ss-editor-field">
                <label htmlFor="tx-qty">الكمية *</label>
                <input id="tx-qty" type="number" step="0.01" className="ss-input" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="0.00" disabled={saving} />
              </div>

              <div className="ss-editor-field">
                <label htmlFor="tx-reason">السبب / الملاحظة</label>
                <input id="tx-reason" className="ss-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="سبب الحركة" disabled={saving} />
              </div>

              <div className="ss-multi-editor-actions">
                <button type="button" className="ss-button ss-button-ghost" onClick={resetForm} disabled={saving}>إعادة تعيين</button>
                <button type="submit" className="ss-button ss-button-primary" disabled={saving || !hasManage}>{saving ? 'جاري الحفظ...' : 'تسجيل الحركة'}</button>
              </div>
            </form>
          )}
        </div>
      </div>
    </DashboardLayout>
  )
}
