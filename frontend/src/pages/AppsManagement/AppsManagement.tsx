import DashboardLayout from '../../components/DashboardLayout/DashboardLayout'
import '../../styles/DashboardViews.css'

type AppStatus = 'available' | 'external'

interface AppCard {
  id: string
  name: string
  description: string
  status: AppStatus
  action: string
  navigateTo?: string
  /**
   * Why the action is unavailable, shown on the button itself.
   *
   * A bare "(قريباً)" tells the operator nothing — it cannot distinguish "we
   * have not built this" from "your deployment has it switched off" from "this
   * needs an account you have not connected", and those need different actions.
   * Only read when the button is disabled.
   */
  unavailableReason?: string
}

export default function AppsManagement({ navigate }: { navigate: (path: string) => void }) {
  const apps: AppCard[] = [
    {
      id: 'shopify',
      name: 'Shopify',
      description: 'ربط متجر Shopify لمزامنة الطلبات والمنتجات والمخزون. الاستيراد من Shopify ورفع مستويات المخزون وتصدير المنتجات إلى Shopify كلها تعمل عند تفعيل الميزة لهذه النسخة.',
      status: 'available',
      action: 'إدارة المتاجر المربوطة',
      navigateTo: '/dashboard/stores'
    },
    
    {
      id: 'api-keys',
      name: 'مفاتيح API — Mawzun AI',
      description: 'أنشئ مفاتيح لعملاء الذكاء الاصطناعي للوصول لبيانات شركتك. التوثيق الكامل على docs.mawzun.org.',
      status: 'available',
      action: 'إدارة المفاتيح',
      navigateTo: '/dashboard/api-keys'
    },
    {
      id: 'sync-errors',
      name: 'أخطاء المزامنة',
      description: 'متابعة أخطاء مزامنة المتاجر وإعادة المحاولة أو تعليمها كمحلولة.',
      status: 'available',
      action: 'عرض الأخطاء',
      navigateTo: '/dashboard/sync-errors'
    },
  ]

  return (
    <DashboardLayout navigate={navigate}>
      <div className="view-container">
        <div className="view-header" style={{ marginBottom: '1.5rem' }}>
          <div>
            <h1 className="view-header-title">الإضافات والربط</h1>
            <p className="view-header-subtitle">اربط النظام بمزودين خارجيين وأدوات الأتمتة. التكاملات غير المتاحة مذكور سببها على الزر نفسه — لا يوجد أي إجراء «قريباً» بلا تفسير.</p>
          </div>
        </div>

        <div className="landing-grid landing-grid-3" style={{ alignItems: 'stretch' }}>
          {apps.map((app) => (
            <article key={app.id} className="landing-card" style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <h3 style={{ margin: 0 }}>{app.name}</h3>
                <span style={{
                  fontSize: '0.7rem',
                  padding: '0.2rem 0.55rem',
                  borderRadius: 999,
                  background: app.status === 'available' ? 'var(--color-success-soft)' : 'var(--bg-secondary)',
                  color: app.status === 'available' ? 'var(--color-success)' : 'var(--text-secondary)'
                }}>
                  {app.status === 'available' ? 'متاح' : 'يتطلب ربط خارجي'}
                </span>
              </div>
              <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-secondary)', flex: 1 }}>{app.description}</p>

              <button
                type="button"
                className={app.status === 'available' ? 'io-button io-button-primary' : 'io-button io-button-ghost'}
                onClick={() => app.navigateTo && navigate(app.navigateTo)}
                disabled={app.status === 'external' && !app.navigateTo}
                title={app.unavailableReason}
              >
                {app.status === 'external' && !app.navigateTo
                  ? `${app.action} — ${app.unavailableReason ?? 'غير متاح'}`
                  : app.action}
              </button>
            </article>
          ))}
        </div>
      </div>
    </DashboardLayout>
  )
}
