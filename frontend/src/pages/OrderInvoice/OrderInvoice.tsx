import { useEffect, useState } from 'react'
import DashboardLayout from '../../components/DashboardLayout/DashboardLayout'
import { salesApi, type OrderInvoice } from '../../lib/api'
import { Button, type Notice } from '../shared/ManagementUi'
import '../SystemSettings/SystemSettings.css'

interface OrderInvoiceProps {
  navigate: (path: string) => void
  orderId: string
}

const fmtMoney = (n: number) => n.toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const STATUS_AR: Record<string, string> = {
  NEW: 'جديد', CONFIRMED: 'مؤكد', POSTPONED: 'مؤجل', CANCELLED: 'ملغي',
  NO_ANSWER: 'لا يرد', DELIVERED: 'تم التوصيل', RETURNED: 'مرتجع',
  NOT_DELIVERED: 'لم يُسلّم', ON_THE_WAY: 'في الطريق', RETURNED_TO_WAREHOUSE: 'أُعيد للمخزن',
}

// Printable invoice: browser-print friendly (window.print), A4 sheet layout.
// All data comes from GET /sales/orders/:id/invoice — no totals computed here.
export default function OrderInvoice({ navigate, orderId }: OrderInvoiceProps) {
  const [invoice, setInvoice] = useState<OrderInvoice | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const data = await salesApi.getOrderInvoice(orderId)
        if (!cancelled) setInvoice(data)
      } catch (error) {
        if (!cancelled) setNotice({ type: 'error', text: error instanceof Error ? error.message : 'تعذر تحميل الفاتورة.' })
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [orderId])

  const print = () => window.print()

  return (
    <DashboardLayout navigate={navigate}>
      <div className="view-container">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }} className="no-print">
          <h1 style={{ margin: 0, fontSize: '1.3rem' }}>فاتورة {invoice?.invoice.orderNumber ?? ''}</h1>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <Button variant="secondary" onClick={() => navigate('/dashboard/orders')}>رجوع للطلبات</Button>
            <Button variant="primary" onClick={print} disabled={!invoice}>طباعة / PDF</Button>
          </div>
        </div>
        {notice && <div className="ss-status ss-status-error" role="alert">{notice.text}</div>}
        {loading && <p>جارٍ التحميل...</p>}
        {invoice && (
          <article
            className="invoice-sheet"
            style={{
              background: 'var(--bg-primary)', color: 'var(--text-primary)', borderRadius: '8px', padding: '2rem',
              maxWidth: '800px', margin: '0 auto', border: '1px solid #ddd',
            }}
          >
            <header style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '2px solid #111', paddingBottom: '1rem', marginBottom: '1.5rem' }}>
              <div>
                <h2 style={{ margin: 0 }}>{invoice.company.name}</h2>
                {invoice.company.address && <p style={{ margin: '0.2rem 0', fontSize: '0.85rem' }}>{invoice.company.address}</p>}
                {invoice.company.phoneNumber && <p style={{ margin: '0.2rem 0', fontSize: '0.85rem' }} dir="ltr">{invoice.company.phoneNumber}</p>}
                {invoice.company.email && <p style={{ margin: '0.2rem 0', fontSize: '0.85rem' }} dir="ltr">{invoice.company.email}</p>}
              </div>
              <div style={{ textAlign: 'left' }}>
                <h3 style={{ margin: 0 }}>فاتورة</h3>
                <p style={{ margin: '0.3rem 0', fontWeight: 700 }} dir="ltr">{invoice.invoice.orderNumber}</p>
                <p style={{ margin: '0.2rem 0', fontSize: '0.85rem' }}>{new Date(invoice.invoice.date).toLocaleDateString('ar-EG')}</p>
                <p style={{ margin: '0.2rem 0', fontSize: '0.85rem' }}>{STATUS_AR[invoice.invoice.status] ?? invoice.invoice.status}</p>
              </div>
            </header>

            <section style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1.5rem', fontSize: '0.95rem' }}>
              <div>
                <strong>العميل:</strong> {invoice.invoice.customerName}
                {invoice.invoice.customerPhone && <span dir="ltr"> — {invoice.invoice.customerPhone}</span>}
                {invoice.invoice.customerEmail && <span dir="ltr"> — {invoice.invoice.customerEmail}</span>}
              </div>
              {invoice.invoice.warehouseName && <div><strong>المخزن:</strong> {invoice.invoice.warehouseName}</div>}
            </section>

            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #111' }}>
                  <th style={{ textAlign: 'right', padding: '0.5rem' }}>الصنف</th>
                  <th style={{ textAlign: 'right', padding: '0.5rem' }}>SKU</th>
                  <th style={{ textAlign: 'center', padding: '0.5rem' }}>الكمية</th>
                  <th style={{ textAlign: 'left', padding: '0.5rem' }}>السعر</th>
                  <th style={{ textAlign: 'left', padding: '0.5rem' }}>الخصم</th>
                  <th style={{ textAlign: 'left', padding: '0.5rem' }}>الإجمالي</th>
                </tr>
              </thead>
              <tbody>
                {invoice.items.map((item, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #eee' }}>
                    <td style={{ padding: '0.5rem' }}>{item.productName}</td>
                    <td style={{ padding: '0.5rem', fontSize: '0.8rem' }} dir="ltr">{item.skuCode ?? '—'}</td>
                    <td style={{ textAlign: 'center', padding: '0.5rem' }}>{item.quantity}</td>
                    <td style={{ textAlign: 'left', padding: '0.5rem' }} dir="ltr">{fmtMoney(item.unitPrice)}</td>
                    <td style={{ textAlign: 'left', padding: '0.5rem' }} dir="ltr">{item.discount > 0 ? fmtMoney(item.discount) : '—'}</td>
                    <td style={{ textAlign: 'left', padding: '0.5rem', fontWeight: 600 }} dir="ltr">{fmtMoney(item.lineTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <section style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'flex-end' }}>
              <table style={{ minWidth: '280px', fontSize: '0.95rem' }}>
                <tbody>
                  <tr><td style={{ padding: '0.3rem 0' }}>المجموع الفرعي</td><td style={{ textAlign: 'left' }} dir="ltr">{fmtMoney(invoice.invoice.subtotal)} {invoice.invoice.currency}</td></tr>
                  {invoice.invoice.shippingCost > 0 && (
                    <tr><td style={{ padding: '0.3rem 0' }}>الشحن</td><td style={{ textAlign: 'left' }} dir="ltr">{fmtMoney(invoice.invoice.shippingCost)} {invoice.invoice.currency}</td></tr>
                  )}
                  {invoice.invoice.discountPercentage > 0 && (
                    <tr><td style={{ padding: '0.3rem 0' }}>خصم الطلب ({invoice.invoice.discountPercentage}%)</td><td style={{ textAlign: 'left' }} dir="ltr">−{fmtMoney(invoice.invoice.discountAmount)} {invoice.invoice.currency}</td></tr>
                  )}
                  {invoice.invoice.couponCode && (
                    <tr><td style={{ padding: '0.3rem 0' }}>كوبون {invoice.invoice.couponCode}</td><td style={{ textAlign: 'left' }}>مُطبّق</td></tr>
                  )}
                  <tr style={{ borderTop: '2px solid #111', fontWeight: 800, fontSize: '1.05rem' }}>
                    <td style={{ padding: '0.5rem 0' }}>الإجمالي</td>
                    <td style={{ textAlign: 'left' }} dir="ltr">{fmtMoney(invoice.invoice.total)} {invoice.invoice.currency}</td>
                  </tr>
                </tbody>
              </table>
            </section>
          </article>
        )}
      </div>
    </DashboardLayout>
  )
}
