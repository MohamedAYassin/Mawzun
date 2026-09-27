import { useCallback, useEffect, useState } from 'react'
import DashboardLayout from '../../components/DashboardLayout/DashboardLayout'
import { purchasingApi, reportsApi, type Vendor, type PurchasesOverview } from '../../lib/api'
import { Button, LoadingState, ModuleHeading, StatusBanner, UsersIcon, type Notice } from '../shared/ManagementUi'
import '../SystemSettings/SystemSettings.css'

interface SupplierOverviewProps {
  navigate: (path: string) => void
}

const fmt = (v: number) => v.toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function SupplierOverview({ navigate }: SupplierOverviewProps) {
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [purchases, setPurchases] = useState<PurchasesOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState<Notice | null>(null)

  const load = useCallback(async (showLoader = true) => {
    if (showLoader) setLoading(true)
    try {
      // The old summary endpoint is gone; these numbers are assembled from the
      // vendor directory and the purchases overview.
      const [vendorPage, purchaseStats] = await Promise.all([
        purchasingApi.listVendors({ pageSize: 200 }),
        reportsApi.purchasesOverview(),
      ])
      setVendors(vendorPage.items)
      setPurchases(purchaseStats)
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'تعذر تحميل ملخص الموردين.' })
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load])

  const p = purchases ?? { receivedCount: 0, receivedAmount: 0, pendingCount: 0, pendingAmount: 0, cancelledCount: 0 }
  // "Top vendors" by purchase activity — outstanding balances no longer exist,
  // so order count is the ranking signal any current endpoint can provide.
  const topVendors = [...vendors].sort((a, b) => (b._count?.purchaseOrders ?? 0) - (a._count?.purchaseOrders ?? 0)).slice(0, 10)
  const tileStyle = { padding: '1rem', background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '10px' }

  return (
    <DashboardLayout navigate={navigate}>
      <div className="view-container">
        <section className="ss-module animate-fade-in">
          <ModuleHeading icon={<UsersIcon />} eyebrow="لوحة الإحصائيات" title="موردين الأمانة" subtitle="ملخص أداء الموردين والمشتريات." />
          <div className="ss-module-actions">
            <Button variant="ghost" onClick={() => void load()} disabled={loading}>تحديث</Button>
          </div>
          <StatusBanner notice={notice} />
          {loading ? <LoadingState /> : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
                <div style={tileStyle}><span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>إجمالي الموردين</span><span style={{ fontSize: '1.35rem', fontWeight: 700, display: 'block', marginTop: '0.25rem' }}>{vendors.length}</span></div>
                <div style={tileStyle}><span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>أوامر شراء مُستلمة</span><span style={{ fontSize: '1.35rem', fontWeight: 700, display: 'block', marginTop: '0.25rem' }}>{p.receivedCount}</span></div>
                <div style={tileStyle}><span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>قيمة المشتريات المستلمة</span><span style={{ fontSize: '1.35rem', fontWeight: 700, display: 'block', marginTop: '0.25rem' }}>{fmt(p.receivedAmount)} ج.م</span></div>
                <div style={tileStyle}><span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>أوامر معلّقة</span><span style={{ fontSize: '1.35rem', fontWeight: 700, display: 'block', marginTop: '0.25rem' }}>{p.pendingCount}</span></div><div style={tileStyle}><span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>قيمة المعلّقة</span><span style={{ fontSize: '1.35rem', fontWeight: 700, display: 'block', marginTop: '0.25rem' }}>{fmt(p.pendingAmount)} ج.م</span></div><div style={tileStyle}><span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>أوامر ملغاة</span><span style={{ fontSize: '1.35rem', fontWeight: 700, display: 'block', marginTop: '0.25rem' }}>{p.cancelledCount}</span></div>
              </div>
              <h3 className="io-section-title">الموردون حسب أوامر الشراء</h3>
              <div className="ss-data-surface">
                {topVendors.length === 0 ? <p style={{ padding: '1rem', color: 'var(--text-muted)' }}>لا توجد بيانات بعد.</p> : (
                  <div className="ss-table-scroll">
                    <table className="ss-table">
                      <thead><tr><th>#</th><th>المورد</th><th>أوامر الشراء</th></tr></thead>
                      <tbody>
                        {topVendors.map((vendor, index) => (
                          <tr key={vendor.id}>
                            <td>{index + 1}</td>
                            <td>{vendor.name}</td>
                            <td>{vendor._count.purchaseOrders}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </DashboardLayout>
  )
}
