import { useCallback, useEffect, useMemo, useState } from 'react'
import DashboardLayout from '../../components/DashboardLayout/DashboardLayout'
import { salesApi, type ShippingReturn } from '../../lib/api'
import { Button, EmptyState, LoadingState, ListToolbar, ModuleHeading, StatusBanner, TruckIcon, PlusIcon, type Notice } from '../shared/ManagementUi'
import '../SystemSettings/SystemSettings.css'

interface ShippingReturnsProps {
  navigate: (path: string) => void
}

const fmt = (v: string | number) => Number(v).toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function ShippingReturns({ navigate }: ShippingReturnsProps) {
  const [items, setItems] = useState<ShippingReturn[]>([])
  const [query, setQuery] = useState('')
  const [collected, setCollected] = useState('')
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [orderInput, setOrderInput] = useState('')
  const [resolvedOrder, setResolvedOrder] = useState<{ id: string; orderNumber: string } | null>(null)
  const [resolving, setResolving] = useState(false)
  const [qtyGood, setQtyGood] = useState('0')
  const [qtyDamaged, setQtyDamaged] = useState('0')
  const [qtyMissing, setQtyMissing] = useState('0')
  const [amountTotal, setAmountTotal] = useState('0')
  const [shippingCost, setShippingCost] = useState('0')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async (showLoader = true) => {
    if (showLoader) setLoading(true)
    try {
      // `collected` is a client-side filter here: the endpoint offers search
      // and pagination, not a collected flag.
      const page = await salesApi.listShippingReturns({ search: query || undefined, pageSize: 200 })
      const filtered = collected === '' ? page.items : page.items.filter((item) => String(item.returnsCollected) === collected)
      setItems(filtered)
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'تعذر تحميل المرتجعات.' })
    } finally { setLoading(false) }
  }, [query, collected])

  useEffect(() => { void load() }, [load])

  const visible = useMemo(() => items, [items])

  // The API takes an order UUID, but a UUID is not something a warehouse clerk
  // has in hand — they have the order NUMBER off the paperwork. Resolve the
  // typed number to the real id here and show what was found, so a wrong order
  // is caught before the return is recorded against it.
  const resolveOrder = async (raw: string) => {
    const code = raw.trim()
    setResolvedOrder(null)
    if (!code) return
    setResolving(true)
    setNotice(null)
    try {
      const found = await salesApi.listOrders({ search: code, pageSize: 5 })
      const match =
        (found.items || []).find((o) => o.orderNumber.toLowerCase() === code.toLowerCase()) ||
        (found.items || [])[0]
      if (match) {
        setResolvedOrder({ id: match.id, orderNumber: match.orderNumber })
      } else {
        setNotice({ type: 'error', text: `لا يوجد طلب مطابق لـ «${code}».` })
      }
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'تعذر البحث عن الطلب.' })
    } finally {
      setResolving(false)
    }
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!resolvedOrder) {
      setNotice({ type: 'error', text: 'ابحث عن الطلب واختره قبل الحفظ.' })
      return
    }
    setSaving(true)
    setNotice(null)
    try {
      await salesApi.createShippingReturn({
        orderId: resolvedOrder.id,
        qtyReturnedGood: Number(qtyGood),
        qtyReturnedDamaged: Number(qtyDamaged),
        qtyReturnedMissing: Number(qtyMissing),
        amountTotal: Number(amountTotal),
        shippingCost: Number(shippingCost)
      })
      setFormOpen(false); setOrderInput(''); setResolvedOrder(null); setQtyGood('0'); setQtyDamaged('0'); setQtyMissing('0'); setAmountTotal('0'); setShippingCost('0')
      await load(false)
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'تعذر إضافة المرتجع.' })
    } finally { setSaving(false) }
  }

  const collect = async (id: string) => {
    try {
      await salesApi.collectShippingReturn(id)
      await load(false)
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'تعذر تحديث حالة التحصيل.' })
    }
  }

  const [scanCode, setScanCode] = useState('')
  const [scanning, setScanning] = useState(false)
  const [scanMatch, setScanMatch] = useState<ShippingReturn | null>(null)

  const receiveByBarcode = async () => {
    const code = scanCode.trim()
    if (!code) return
    setScanning(true)
    setNotice(null)
    try {
      const result = await salesApi.listShippingReturns({ search: code, pageSize: 5 })
      // Returns are identified by their reference number, which is what the
      // printed receipt shows — the old `name` field no longer exists.
      const match = (result.items || []).find(r => r.referenceNumber.toLowerCase() === code.toLowerCase()) || (result.items || [])[0]
      if (match) {
        setScanMatch(match)
        setScanCode('')
      } else {
        setScanMatch(null)
        setNotice({ type: 'error', text: `لا يوجد مرتجع مطابق للكود «${code}».` })
      }
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'تعذر البحث عن المرتجع.' })
    } finally {
      setScanning(false)
    }
  }

  const printReturn = (item: ShippingReturn) => {
    const printWindow = window.open('', '_blank', 'width=800,height=900')
    if (!printWindow) {
      alert('يرجى السماح بالنوافذ المنبثقة للطباعة.')
      return
    }
    const row = (label: string, value: string) => `<tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:700;background:#f7f7f7">${label}</td><td style="padding:8px 12px;border:1px solid #ddd">${value}</td></tr>`
    printWindow.document.write(`<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><title>إيصال مرتجع - ${item.referenceNumber}</title><style>body{font-family:system-ui,'Segoe UI',sans-serif;padding:32px;color:#111}h1{font-size:1.4rem;margin:0 0 4px}p.sub{color:#555;margin:0 0 20px;font-size:.9rem}table{border-collapse:collapse;width:100%;font-size:.95rem}</style></head><body>
      <h1>إيصال استلام مرتجع</h1>
      <p class="sub">${item.referenceNumber} — ${new Date().toLocaleString('ar-EG')}</p>
      <table>
        ${row('شركة الشحن', item.carrier?.name || '—')}
        ${row('الطلب', item.order?.orderNumber || '—')}
        ${row('العميل', item.customer ? `${item.customer.name} (${item.customer.phoneNumber1})` : '—')}
        ${item.notes ? row('ملاحظات', item.notes) : ''}
        ${row('الكمية السليمة', String(item.qtyReturnedGood))}
        ${row('الكمية التالفة', String(item.qtyReturnedDamaged))}
        ${row('الكمية المفقودة', String(item.qtyReturnedMissing))}
        ${row('المبلغ بدون الشحن', fmt(item.amountTotal) + ' ج.م')}
        ${row('سعر الشحن', fmt(item.shippingCost) + ' ج.م')}
        ${row('المبلغ بالشحن', fmt(item.amountWithShipping) + ' ج.م')}
        ${row('حالة التحصيل', item.returnsCollected ? 'محصّل' : 'غير محصّل')}
      </table>
      <script>window.onload=function(){setTimeout(function(){window.print();window.close()},300)}</script>
    </body></html>`)
    printWindow.document.close()
  }
  return (
    <DashboardLayout navigate={navigate}>
      <div className="view-container">
        <section className="ss-module animate-fade-in">
          <ModuleHeading icon={<TruckIcon />} eyebrow="الشحن" title="استلام المرتجعات" subtitle="متابعة المرتجعات المجمعة من شركات الشحن وتحصيلها." />
          <div className="ss-module-actions">
            <span className="ss-count-chip"><strong>{visible.length}</strong> مرتجع</span>
            <Button variant="primary" onClick={() => setFormOpen(open => !open)}><PlusIcon /> مرتجع جديد</Button>
            <Button variant="ghost" onClick={() => void load()} disabled={loading}>تحديث</Button>
          </div>
          <StatusBanner notice={notice} />
          <div className="ss-list-toolbar" style={{ marginBottom: '0.75rem' }}>
            <label className="ss-search" style={{ maxWidth: 320 }}>
              <input
                placeholder="استلام بالباركود — امسح أو أدخل كود المرتجع ثم Enter"
                value={scanCode}
                onChange={(e) => setScanCode(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void receiveByBarcode() } }}
                disabled={scanning}
              />
            </label>
            <Button variant="ghost" onClick={() => void receiveByBarcode()} disabled={scanning || !scanCode.trim()}>
              {scanning ? 'جاري البحث...' : 'استلام'}
            </Button>
          </div>
          {scanMatch && (
            <div className="ss-multi-editor" style={{ marginBottom: '0.75rem' }}>
              <div className="ss-editor-field ss-multi-editor-full">
                <span className="ss-editor-kicker">مرتجع مطابق</span>
                <h3>{scanMatch.referenceNumber}</h3>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  {scanMatch.carrier?.name || 'بدون شركة شحن'} — سليم {scanMatch.qtyReturnedGood} / تالف {scanMatch.qtyReturnedDamaged} / مفقود {scanMatch.qtyReturnedMissing} — الإجمالي بالشحن {fmt(scanMatch.amountWithShipping)} ج.م
                </p>
              </div>
              <div className="ss-editor-field" style={{ display: 'flex', alignItems: 'flex-end' }}>
                <div className="ss-row-actions" style={{ gap: '0.5rem' }}>
                  <Button onClick={() => printReturn(scanMatch)}>طباعة الإيصال</Button>
                  {!scanMatch.returnsCollected && <Button variant="ghost" onClick={() => { void collect(scanMatch.id); setScanMatch(null) }}>تحصيل</Button>}
                  <Button variant="ghost" onClick={() => setScanMatch(null)}>إخفاء</Button>
                </div>
              </div>
            </div>
          )}
          {formOpen && (
            <form className="ss-form-grid" onSubmit={submit} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem', padding: '1rem', border: '1px solid var(--border-color)', borderRadius: '10px', marginBottom: '1rem' }}>
              <input
                className="ss-input"
                placeholder="رقم الطلب (مثال ORD-000146)"
                value={orderInput}
                onChange={e => { setOrderInput(e.target.value); setResolvedOrder(null) }}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void resolveOrder(orderInput) } }}
                onBlur={() => { if (orderInput.trim() && !resolvedOrder) void resolveOrder(orderInput) }}
                disabled={resolving}
                required
              />
              <input className="ss-input" type="number" min="0" placeholder="السليم" value={qtyGood} onChange={e => setQtyGood(e.target.value)} />
              <input className="ss-input" type="number" min="0" placeholder="التالف" value={qtyDamaged} onChange={e => setQtyDamaged(e.target.value)} />
              <input className="ss-input" type="number" min="0" placeholder="المفقود" value={qtyMissing} onChange={e => setQtyMissing(e.target.value)} />
              <input className="ss-input" type="number" min="0" step="0.01" placeholder="المبلغ" value={amountTotal} onChange={e => setAmountTotal(e.target.value)} />
              <input className="ss-input" type="number" min="0" step="0.01" placeholder="سعر الشحن" value={shippingCost} onChange={e => setShippingCost(e.target.value)} />
              <Button variant="ghost" type="button" onClick={() => void resolveOrder(orderInput)} disabled={resolving || !orderInput.trim()}>
                {resolving ? 'جاري البحث...' : 'بحث عن الطلب'}
              </Button>
              <Button variant="primary" type="submit" disabled={saving || !resolvedOrder}>{saving ? 'جاري الحفظ...' : 'حفظ'}</Button>
              {resolvedOrder && (
                <div className="ss-editor-field ss-multi-editor-full" style={{ gridColumn: '1 / -1' }}>
                  <span className="ss-editor-kicker">الطلب المحدد</span>
                  <strong dir="ltr" style={{ fontFamily: 'monospace' }}>{resolvedOrder.orderNumber}</strong>
                </div>
              )}
            </form>
          )}
          <div className="ss-list-toolbar">
            <ListToolbar query={query} setQuery={setQuery} placeholder="ابحث عن مرتجع..." lastLoaded={null} />
            <select className="ss-input" value={collected} onChange={e => setCollected(e.target.value)} aria-label="حالة التحصيل">
              <option value="">كل الحالات</option>
              <option value="false">غير محصّل</option>
              <option value="true">محصّل</option>
            </select>
          </div>
          <div className="ss-data-surface">
            {loading ? <LoadingState /> : visible.length === 0 ? <EmptyState hasSearch={Boolean(query.trim() || collected)} /> : (
              <div className="ss-table-scroll">
                <table className="ss-table">
                  <thead><tr><th>#</th><th>المرتجع</th><th>الطلب</th><th>العميل</th><th>شركة الشحن</th><th>السليم</th><th>التالف</th><th>المفقود</th><th>المبلغ بدون الشحن</th><th>سعر الشحن</th><th>المبلغ بالشحن</th><th>الحالة</th><th>تحصيل</th><th>طباعة</th></tr></thead>
                  <tbody>
                    {visible.map((item, index) => (
                      <tr key={item.id}>
                        <td>{index + 1}</td>
                        <td><span dir="ltr" style={{ fontFamily: 'monospace' }}>{item.referenceNumber}</span>{item.notes ? <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', maxWidth: 220 }}>{item.notes}</div> : null}<div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{new Date(item.createdAt).toLocaleDateString('ar-EG')}</div></td>
                        <td><span dir="ltr" style={{ fontFamily: 'monospace' }}>{item.order?.orderNumber ?? '—'}</span></td>
                        <td>{item.customer ? `${item.customer.name} (${item.customer.phoneNumber1})` : '—'}</td>
                        <td>{item.carrier?.name || '—'}</td>
                        <td>{item.qtyReturnedGood}</td>
                        <td>{item.qtyReturnedDamaged}</td>
                        <td>{item.qtyReturnedMissing}</td>
                        <td>{fmt(item.amountTotal)}</td>
                        <td>{fmt(item.shippingCost)}</td>
                        <td>{fmt(item.amountWithShipping)}</td>
                        <td>{item.returnsCollected ? `محصّل${item.returnsCollectedAt ? ` (${new Date(item.returnsCollectedAt).toLocaleDateString('ar-EG')})` : ''}` : 'غير محصّل'}</td>
                        <td>{!item.returnsCollected && <Button variant="ghost" onClick={() => void collect(item.id)}>تحصيل</Button>}</td>
                        <td><Button variant="ghost" onClick={() => printReturn(item)}>طباعة</Button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      </div>
    </DashboardLayout>
  )
}
