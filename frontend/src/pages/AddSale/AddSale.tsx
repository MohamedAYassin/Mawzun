import { useState, useEffect, useCallback, useRef } from 'react'
import { toast } from "sonner";
import DashboardLayout from '../../components/DashboardLayout/DashboardLayout'
import { Select } from '../../components/Select/Select'
import {
  salesApi,
  shippingApi,
  inventoryApi,
  catalogApi,
  type Governorate,
  type City,
  type Warehouse,
  type OrderConfigEntry,
  type Carrier,
  type ProductListItem,
} from '../../lib/api'
import '../../styles/DashboardViews.css'
import './AddSale.css'

const STORAGE_KEY = 'formDraft_addSale'

interface AddSaleProps {
  navigate: (path: string) => void
}

interface DraftData {
  step: number
  custName: string
  custPhone: string
  custPhone2: string
  govId: string
  cityId: string
  whId: string
  sourceId: string
  payId: string
  shipId: string
  shipCost: string
  discountPercent: string
  couponCode: string
  address: string
  notes: string
  items: { productId: string; quantity: number; unitPrice: number; discountPercent?: number }[]
}

function defaultDraft(): DraftData {
  return {
    step: 0,
    custName: '',
    custPhone: '',
    custPhone2: '',
    govId: '',
    cityId: '',
    whId: '',
    sourceId: '',
    payId: '',
    shipId: '',
    shipCost: '50',
    discountPercent: '0',
    couponCode: '',
    address: '',
    notes: '',
    items: [],
  }
}

function loadDraft(): DraftData | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw) as DraftData
  } catch { /* ignore */ }
  return null
}

function persistDraft(data: DraftData) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch { /* ignore */ }
}

function clearDraft() {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch { /* ignore */ }
}

const STEPS = ['معلومات العميل', 'تفاصيل الطلب', 'المنتجات', 'مراجعة']

export default function AddSale({ navigate }: AddSaleProps) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [govs, setGovs] = useState<Governorate[]>([])
  const [cities, setCities] = useState<City[]>([])
  const [citiesLoading, setCitiesLoading] = useState(false)
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [sources, setSources] = useState<OrderConfigEntry[]>([])
  const [payments, setPayments] = useState<OrderConfigEntry[]>([])
  const [shippings, setShippings] = useState<Carrier[]>([])
  const [products, setProducts] = useState<ProductListItem[]>([])

  const [draft, setDraft] = useState<DraftData>(defaultDraft)
  const [step, setStep] = useState(0)
  const restoredRef = useRef(false)

  const updateDraft = useCallback((patch: Partial<DraftData>) => {
    setDraft(prev => {
      const next = { ...prev, ...patch }
      persistDraft(next)
      return next
    })
  }, [])

  const loadInitialData = useCallback(async () => {
    setLoading(true)
    try {
      const [gList, wList, sList, pList, shList, prPage] = await Promise.all([
        shippingApi.listGovernorates().catch(() => ({ items: [] as Governorate[] })),
        inventoryApi.listWarehouses().catch(() => []),
        salesApi.listOrderSources().catch(() => []),
        salesApi.listPaymentMethods().catch(() => []),
        shippingApi.listCarriers({ pageSize: 100 }).catch(() => ({ items: [] as Carrier[] })),
        catalogApi.listProducts({ isActive: true, pageSize: 200 }).catch(() => ({ items: [] as ProductListItem[] })),
      ])
      setGovs(gList.items)
      setWarehouses(wList)
      setSources(sList)
      setPayments(pList)
      setShippings(shList.items)
      setProducts(prPage.items)

      const saved = loadDraft()
      if (saved && !restoredRef.current) {
        restoredRef.current = true
        setDraft(saved)
        setStep(saved.step)
      } else {
        const patch: Partial<DraftData> = {
        }
        const firstProduct = prPage.items[0]
        if (firstProduct) {
          patch.items = [{ productId: firstProduct.id, quantity: 1, unitPrice: Number(firstProduct.price) }]
        }
        patch.govId = gList.items[0]?.id || ''
        patch.whId = wList[0]?.id || ''
        patch.sourceId = sList[0]?.id || ''
        patch.payId = pList[0]?.id || ''
        patch.shipId = shList.items[0]?.id || ''
        updateDraft(patch)
      }

      const effectiveGovId = saved?.govId || gList.items[0]?.id || ''
      if (effectiveGovId) {
        setCitiesLoading(true)
        try {
          const cPage = await shippingApi.listCitiesOfGovernorate(effectiveGovId, { pageSize: 200 })
          setCities(cPage.items)
          if (!saved) {
            updateDraft({ cityId: cPage.items[0]?.id || '' })
          }
        } catch {
          setCities([])
        } finally {
          setCitiesLoading(false)
        }
      }
    } catch {
    } finally {
      setLoading(false)
    }
  }, [updateDraft])

  useEffect(() => {
    void loadInitialData()
  }, [loadInitialData])

  const handleGovernorateChange = async (newGovId: string) => {
    updateDraft({ govId: newGovId, cityId: '' })
    if (!newGovId) {
      setCities([])
      return
    }
    setCitiesLoading(true)
    try {
      const page = await shippingApi.listCitiesOfGovernorate(newGovId, { pageSize: 200 })
      setCities(page.items)
      updateDraft({ cityId: page.items[0]?.id || '' })
    } catch {
      setCities([])
    } finally {
      setCitiesLoading(false)
    }
  }

  const handleItemAdd = () => {
    if (products.length === 0) return
    const newItems = [...draft.items, { productId: products[0].id, quantity: 1, unitPrice: Number(products[0].price), discountPercent: 0 }]
    updateDraft({ items: newItems })
  }

  const handleItemRemove = (idx: number) => {
    updateDraft({ items: draft.items.filter((_, i) => i !== idx) })
  }

  const handleItemUpdate = (idx: number, key: string, val: any) => {
    const updated = [...draft.items]
    updated[idx] = { ...updated[idx], [key]: val }
    if (key === 'productId') {
      const price = Number(products.find(p => p.id === val)?.price || 0)
      updated[idx].unitPrice = price
    }
    updateDraft({ items: updated })
  }

  const goToStep = (newStep: number) => {
    setStep(newStep)
    updateDraft({ step: newStep })
  }

  const canProceed = (): boolean => {
    if (step === 0) return draft.custName.trim().length > 0 && draft.custPhone.trim().length > 0
    if (step === 2) return draft.items.length > 0
    return true
  }

  const submit = async () => {
    if (!draft.custName.trim() || !draft.custPhone.trim() || draft.items.length === 0) {
      toast.error('يرجى إدخال اسم العميل ورقم هاتفه مع منتج واحد على الأقل.')
      return
    }

    setSaving(true)
    try {
      // The customer is resolved by phone: reuse the record if the number is
      // already known, otherwise create it — one call, no race.
      const { customer } = await salesApi.findOrCreateCustomer({
        name: draft.custName.trim(),
        phoneNumber1: draft.custPhone.trim(),
        phoneNumber2: draft.custPhone2.trim() || null,
      })
      await salesApi.createOrder({
        type: 'SALE',
        customerId: customer.id,
        shippingGovernorateId: draft.govId || null,
        cityId: draft.cityId || null,
        warehouseId: draft.whId || null,
        orderSourceId: draft.sourceId || null,
        paymentMethodId: draft.payId || null,
        carrierId: draft.shipId || null,
        shippingCost: Number(draft.shipCost),
        discountPercentage: Number(draft.discountPercent),
        couponCode: (draft.couponCode ?? '').trim() || null,
        detailedAddress: draft.address.trim(),
        notes: draft.notes.trim(),
        items: draft.items.map(i => ({
          productId: i.productId,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          itemDiscountPercentage: Number(i.discountPercent || 0) || undefined,
          discountType: 'PERCENTAGE' as const,
        })),
      })
      toast.success('تم تسجيل طلب المبيعات بنجاح.')
      clearDraft()
      setDraft(defaultDraft())
      setStep(0)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'تعذر حفظ الطلب.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <DashboardLayout navigate={navigate}>
        <div className="view-container">
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 300, color: 'var(--text-primary)' }}>
            جاري التحميل...
          </div>
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout navigate={navigate}>
      <div className="view-container">
        <div className="view-header" style={{ marginBottom: '1.5rem' }}>
          <div>
            <h1 className="view-header-title">اضافه مبيعات</h1>
            <p className="view-header-subtitle">تسجيل طلب مبيعات جديد - متعدد الخطوات.</p>
          </div>
        </div>

        <div className="as-step-indicator">
          {STEPS.map((label, i) => (
            <div
              key={i}
              className={`as-step-item ${i === step ? 'as-step-active' : ''} ${i < step ? 'as-step-done' : ''}`}
              onClick={() => i < step ? goToStep(i) : undefined}
            >
              <div className="as-step-circle">{i < step ? '✓' : i + 1}</div>
              <div className="as-step-label">{label}</div>
            </div>
          ))}
        </div>

        <form className="io-multi-editor" style={{ background: 'var(--bg-secondary)', padding: '1rem', borderRadius: '12px' }}>
          {step === 0 && (
            <>
              <div className="io-multi-editor-full">
                <h3>معلومات العميل</h3>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-primary)' }}>أدخل بيانات العميل الأساسية والعنوان.</p>
              </div>

              <div className="io-editor-field">
                <label>اسم العميل *</label>
                <input className="pb-input" value={draft.custName} onChange={(e) => updateDraft({ custName: e.target.value })} placeholder="الاسم الكامل" disabled={saving} />
              </div>

              <div className="io-editor-field">
                <label>رقم الهاتف الأساسي *</label>
                <input className="pb-input" value={draft.custPhone} onChange={(e) => updateDraft({ custPhone: e.target.value })} placeholder="01xxxxxxxxx" disabled={saving} />
              </div>

              <div className="io-editor-field">
                <label>رقم الهاتف الاحتياطي</label>
                <input className="pb-input" value={draft.custPhone2} onChange={(e) => updateDraft({ custPhone2: e.target.value })} placeholder="رقم بديل" disabled={saving} />
              </div>

              <div className="io-editor-field">
                <label>المحافظة</label>
                <Select value={draft.govId} onChange={handleGovernorateChange} options={govs.map(g => ({ value: g.id, label: g.name }))} disabled={saving} />
              </div>

              <div className="io-editor-field">
                <label>المدينة</label>
                <Select value={draft.cityId} onChange={(v) => updateDraft({ cityId: v })} options={cities.map(c => ({ value: c.id, label: c.name }))} disabled={saving} loading={citiesLoading} placeholder={citiesLoading ? undefined : 'اختر المدينة'} />
              </div>

              <div className="io-editor-field io-multi-editor-full">
                <label>العنوان بالتفصيل</label>
                <input className="pb-input" value={draft.address} onChange={(e) => updateDraft({ address: e.target.value })} placeholder="الشارع، رقم العمارة، الشقة" disabled={saving} />
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <div className="io-multi-editor-full">
                <h3>تفاصيل الطلب</h3>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-primary)' }}>حدد المستودع ومصدر الطلب وطريقة الدفع والشحن.</p>
              </div>

              <div className="io-editor-field">
                <label>مستودع الصرف</label>
                <Select value={draft.whId} onChange={(v) => updateDraft({ whId: v })} options={warehouses.map(w => ({ value: w.id, label: w.name }))} disabled={saving} />
              </div>

              <div className="io-editor-field">
                <label>مصدر الطلب</label>
                <Select value={draft.sourceId} onChange={(v) => updateDraft({ sourceId: v })} options={sources.map(s => ({ value: s.id, label: s.name }))} disabled={saving} />
              </div>

              <div className="io-editor-field">
                <label>طريقة الدفع</label>
                <Select value={draft.payId} onChange={(v) => updateDraft({ payId: v })} options={payments.map(p => ({ value: p.id, label: p.name }))} disabled={saving} />
              </div>

              <div className="io-editor-field">
                <label>شركة الشحن</label>
                <Select value={draft.shipId} onChange={(v) => updateDraft({ shipId: v })} options={shippings.map(sh => ({ value: sh.id, label: sh.name }))} disabled={saving} />
              </div>

              <div className="io-editor-field">
                <label>تكلفة الشحن (ج.م)</label>
                <input type="number" className="pb-input" value={draft.shipCost} onChange={(e) => updateDraft({ shipCost: e.target.value })} disabled={saving} />
              </div>

              <div className="io-editor-field">
                <label>نسبة الخصم الإجمالي (%)</label>
                <input type="number" className="pb-input" value={draft.discountPercent} onChange={(e) => updateDraft({ discountPercent: e.target.value })} disabled={saving} />

              <div className="io-editor-field">
                <label>كود الخصم (اختياري)</label>
                <input type="text" className="pb-input" value={draft.couponCode ?? ''} onChange={(e) => updateDraft({ couponCode: e.target.value })} placeholder="مثال: SAVE10" disabled={saving} style={{ direction: 'ltr' }} />
              </div>
              </div>

              <div className="io-editor-field io-multi-editor-full">
                <label>ملاحظات إضافية</label>
                <input className="pb-input" value={draft.notes} onChange={(e) => updateDraft({ notes: e.target.value })} placeholder="تعليمات الشحن أو ملاحظات التغليف" disabled={saving} />
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <div className="io-multi-editor-full">
                <h3>المنتجات</h3>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-primary)' }}>أضف المنتجات والكميات المطلوبة.</p>
              </div>

              <div className="io-multi-editor-full io-nested-form-section">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <strong>عناصر الطلب *</strong>
                  <button type="button" className="io-button io-button-secondary" onClick={handleItemAdd} disabled={saving || products.length === 0}>+ إضافة منتج</button>
                </div>
                {draft.items.length === 0 && (
                  <p style={{ color: 'var(--text-primary)', fontSize: '0.85rem' }}>لم تُضف أي منتجات بعد. أضف منتجاً واحداً على الأقل.</p>
                )}
                {draft.items.map((it, idx) => (
                  <div className="io-nested-row" key={idx}>
                    <div>
                      <label>المنتج</label>
                      <Select value={it.productId} onChange={(v) => handleItemUpdate(idx, 'productId', v)} options={products.map(p => ({ value: p.id, label: `${p.name} (${p.price} ج.م)` }))} disabled={saving} />
                    </div>
                    <div>
                      <label>الكمية</label>
                      <input type="number" className="pb-input" value={it.quantity} onChange={(e) => handleItemUpdate(idx, 'quantity', Number(e.target.value))} disabled={saving} />
                    </div>
                    <div>
                      <label>سعر الوحدة</label>
                      <input type="number" className="pb-input" value={it.unitPrice} disabled />
                    </div>
                    <div>
                      <label>خصم %</label>
                      <input type="number" className="pb-input" min={0} max={100} value={it.discountPercent ?? 0} onChange={(e) => handleItemUpdate(idx, 'discountPercent', Number(e.target.value))} disabled={saving} />
                    </div>
                    <div className="io-nested-row-btn">
                      <button type="button" className="io-button io-button-danger" onClick={() => handleItemRemove(idx)} disabled={saving}>حذف</button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <div className="io-multi-editor-full">
                <h3>مراجعة الطلب</h3>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-primary)' }}>راجع بيانات الطلب قبل التأكيد.</p>
              </div>

              <div className="io-multi-editor-full as-review-grid">
                <div className="as-review-section">
                  <h4>معلومات العميل</h4>
                  <div><span>الاسم:</span> {draft.custName}</div>
                  <div><span>الهاتف:</span> {draft.custPhone}</div>
                  {draft.custPhone2 && <div><span>هاتف بديل:</span> {draft.custPhone2}</div>}
                  <div><span>المحافظة:</span> {govs.find(g => g.id === draft.govId)?.name || '—'}</div>
                  <div><span>المدينة:</span> {cities.find(c => c.id === draft.cityId)?.name || '—'}</div>
                  {draft.address && <div><span>العنوان:</span> {draft.address}</div>}
                </div>
                <div className="as-review-section">
                  <h4>تفاصيل الطلب</h4>
                  <div><span>المستودع:</span> {warehouses.find(w => w.id === draft.whId)?.name || '—'}</div>
                  <div><span>المصدر:</span> {sources.find(s => s.id === draft.sourceId)?.name || '—'}</div>
                  <div><span>الدفع:</span> {payments.find(p => p.id === draft.payId)?.name || '—'}</div>
                  <div><span>الشحن:</span> {shippings.find(sh => sh.id === draft.shipId)?.name || '—'}</div>
                  <div><span>التكلفة:</span> {draft.shipCost} ج.م</div>
                  <div><span>الخصم:</span> {draft.discountPercent}%</div>
                  {(draft.couponCode ?? '').trim() && <div><span>الكوبون:</span> {(draft.couponCode ?? '').trim()}</div>}
                  {draft.items.some(it => Number(it.discountPercent || 0) > 0) && (
                    <div><span>خصم على الأصناف:</span> {draft.items.filter(it => Number(it.discountPercent || 0) > 0).map(it => `${it.productId} (${it.discountPercent}%)`).join('، ')}</div>
                  )}
                  {draft.notes && <div><span>ملاحظات:</span> {draft.notes}</div>}
                </div>
                <div className="as-review-section as-review-section-full">
                  <h4>المنتجات</h4>
                  {draft.items.length === 0 ? (
                    <p style={{ color: 'var(--text-primary)' }}>لا توجد منتجات.</p>
                  ) : (
                    <table className="as-review-table">
                      <thead>
                        <tr>
                          <th>المنتج</th>
                          <th>الكمية</th>
                          <th>سعر الوحدة</th>
                          <th>الإجمالي</th>
                        </tr>
                      </thead>
                      <tbody>
                        {draft.items.map((it, idx) => {
                          const p = products.find(pr => pr.id === it.productId)
                          return (
                            <tr key={idx}>
                              <td>{p?.name || '—'}</td>
                              <td>{it.quantity}</td>
                              <td>{it.unitPrice}</td>
                              <td>{it.quantity * it.unitPrice}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </>
          )}

          <div className="io-multi-editor-full as-nav-buttons">
            {step > 0 && (
              <button type="button" className="io-button io-button-ghost" onClick={() => goToStep(step - 1)} disabled={saving}>
                السابق
              </button>
            )}
            {step < STEPS.length - 1 ? (
              <button type="button" className="io-button io-button-primary" onClick={() => goToStep(step + 1)} disabled={!canProceed() || saving}>
                التالي
              </button>
            ) : (
              <button type="button" className="io-button io-button-primary" onClick={submit} disabled={saving}>
                {saving ? 'جاري الحفظ...' : 'تسجيل الطلب'}
              </button>
            )}
          </div>
        </form>
      </div>
    </DashboardLayout>
  )
}
