import { useEffect, useState, useMemo } from 'react'
import DashboardLayout from '../../components/DashboardLayout/DashboardLayout'
import { rolesApi } from '../../lib/api'
import { toArabicNumerals } from '../../utils/arabicNumerals'
import '../SystemSettings/SystemSettings.css'

interface PermissionsProps {
  navigate: (path: string) => void
}

const permissionDetails: Record<string, { label: string; desc: string; category: string }> = {
  'Permissions.ManageUsers': { label: 'إدارة حسابات المستخدمين', desc: 'صلاحية لإنشاء وتعديل وتجميد حسابات الموظفين وتغيير كلمات المرور الخاصة بهم.', category: 'المستخدمين والأمن' },
  'Permissions.ManageRoles': { label: 'إدارة الأدوار ومجموعات الصلاحيات', desc: 'صلاحية لتعريف وتعديل الأدوار الوظيفية وربطها بالصلاحيات المختلفة بالسيستم.', category: 'المستخدمين والأمن' },
  'Permissions.ViewProducts': { label: 'استعراض سجل المنتجات', desc: 'عرض كروت المنتجات والكميات الفعلية في المخازن دون تعديلها.', category: 'المنتجات وكروت الصنف' },
  'Permissions.CreateProduct': { label: 'إضافة منتجات جديدة', desc: 'تسجيل أصناف جديدة، تعيين الباركود، والأسعار، والتكاليف الأساسية وتحديد هوامش الربح.', category: 'المنتجات وكروت الصنف' },
  'Permissions.UpdateProduct': { label: 'تعديل كروت المنتجات', desc: 'تحديث تفاصيل المنتج، صوره، تعديل الفئات أو العلامات التجارية المربوطة به.', category: 'المنتجات وكروت الصنف' },
  'Permissions.DeleteProduct': { label: 'حذف منتج من السيستم', desc: 'إزالة بيانات المنتجات نهائياً من سجلات الإدخال.', category: 'المنتجات وكروت الصنف' },
  'Permissions.ViewOrders': { label: 'استعراض تفاصيل وفواتير الطلبات', desc: 'تصفح طلبات المبيعات والمشتريات وإحصائياتها المالية وتصدير التقارير.', category: 'المبيعات والمشتريات والطلبات' },
  'Permissions.CreateOrder': { label: 'إنشاء الفواتير والطلبات', desc: 'تنزيل طلبات جديدة للمبيعات وتسجيل المرتجعات أو الاستبدالات للمشتريات.', category: 'المبيعات والمشتريات والطلبات' },
  'Permissions.UpdateOrder': { label: 'تعديل بيانات وفواتير الطلبات', desc: 'تعديل تفاصيل الطلبات، كميات المنتجات، أو بيانات المستودع المربوط للتنفيذ.', category: 'المبيعات والمشتريات والطلبات' },
  'Permissions.DeleteOrder': { label: 'إلغاء وحذف الفواتير', desc: 'حذف فواتير الطلبات من السيستم.', category: 'المبيعات والمشتريات والطلبات' },
  'Permissions.ViewCustomers': { label: 'استعراض بيانات العملاء', desc: 'عرض قائمة العملاء، تفاصيلهم، هواتفهم، وتاريخ طلباتهم.', category: 'إدارة العملاء' },
  'Permissions.CreateCustomer': { label: 'تسجيل عميل جديد', desc: 'إضافة عملاء جدد للسيستم وتحديد عناوينهم الجغرافية وبيانات الاتصال.', category: 'إدارة العملاء' },
  'Permissions.UpdateCustomer': { label: 'تعديل بيانات العملاء', desc: 'تحديث أرقام هواتف العملاء أو عناوين الشحن الخاصة بهم.', category: 'إدارة العملاء' },
  'Permissions.DeleteCustomer': { label: 'حذف بيانات العميل', desc: 'إزالة كرت العميل نهائياً من السيستم.', category: 'إدارة العملاء' },
  'Permissions.ViewCategories': { label: 'استعراض الأقسام والتصنيفات', desc: 'عرض شجرة أقسام المنتجات الفرعية والرئيسية بالسيستم.', category: 'إعدادات النظام العامة' },
  'Permissions.CreateCategory': { label: 'إضافة قسم للمنتجات', desc: 'إنشاء تصنيف جديد وربطه بالأقسام الرئيسية ورفع صورته الموضحة.', category: 'إعدادات النظام العامة' },
  'Permissions.UpdateCategory': { label: 'تعديل أقسام المنتجات', desc: 'تغيير اسم القسم، الوصف، أو القسم الأب في هيكلية النظام.', category: 'إعدادات النظام العامة' },
  'Permissions.DeleteCategory': { label: 'حذف أقسام المنتجات', desc: 'حذف فئات أو تصنيفات المنتجات المحددة.', category: 'إعدادات النظام العامة' },
  'Permissions.ViewBrands': { label: 'استعراض العلامات التجارية', desc: 'عرض الماركات المسجلة بالسيستم.', category: 'إعدادات النظام العامة' },
  'Permissions.CreateBrand': { label: 'تسجيل علامة تجارية جديدة', desc: 'إضافة ماركة جديدة للنظام ورفع شعارها التعريفي.', category: 'إعدادات النظام العامة' },
  'Permissions.UpdateBrand': { label: 'تعديل العلامات التجارية', desc: 'تحديث اسم الماركة، الوصف، أو تعديل ملف الشعار المرفق.', category: 'إعدادات النظام العامة' },
  'Permissions.DeleteBrand': { label: 'حذف العلامة التجارية', desc: 'حذف العلامة التجارية نهائياً من النظام.', category: 'إعدادات النظام العامة' },
  'Permissions.ViewWarehouses': { label: 'استعراض مستودعات التخزين', desc: 'عرض قائمة المخازن الفعلية وكود كل مخزن وعناوينها الجغرافية.', category: 'المخازن ومواقع التخزين' },
  'Permissions.CreateWarehouse': { label: 'إضافة مستودع تخزين جديد', desc: 'تسجيل مستودع جديد بالسيستم وتحديد كود التعرف الخاص به.', category: 'المخازن ومواقع التخزين' },
  'Permissions.UpdateWarehouse': { label: 'تعديل بيانات المستودعات', desc: 'تحديث عناوين المخازن، هواتفها، أو ملاحظات التسليم الخاصة بها.', category: 'المخازن ومواقع التخزين' },
  'Permissions.DeleteWarehouse': { label: 'حذف مستودعات التخزين', desc: 'حذف المخزن من السيستم.', category: 'المخازن ومواقع التخزين' },
  'Permissions.ViewStorageLocations': { label: 'استعراض مواقع الرفوف الداخلية', category: 'المخازن ومواقع التخزين', desc: 'عرض الرفوف والأقسام الجغرافية الداخلية المحددة بكل مستودع.' },
  'Permissions.CreateStorageLocation': { label: 'إضافة موقع رف تخزين داخلي', category: 'المخازن ومواقع التخزين', desc: 'تحديد رف أو صف أو صندوق جديد داخل مستودع محدد للفرز.' },
  'Permissions.UpdateStorageLocation': { label: 'تعديل بيانات رفوف التخزين', category: 'المخازن ومواقع التخزين', desc: 'تغيير مسمى الرف أو تعديل كود الرف المربوط.' },
  'Permissions.DeleteStorageLocation': { label: 'حذف رفوف التخزين الداخلية', category: 'المخازن ومواقع التخزين', desc: 'حذف موقع الرف من السيستم.' },
  'Permissions.ManageSettings': { label: 'إدارة تهيئة النظام المرجعية', desc: 'الوصول لقسم إعدادات النظام وتعديل طرق الدفع، شركات الشحن ومصادر الطلبات ومناطق التوزيع.', category: 'إعدادات النظام العامة' },
  'Permissions.ChangeOrderItemPrice': { label: 'تغيير السعر الفردي لعنصر الطلب', desc: 'تخطي الأسعار الافتراضية للمنتج وتطبيق أسعار مبيعات مخصصة في الفاتورة.', category: 'المبيعات والمشتريات والطلبات' },
  'Permissions.ManageInventory': { label: 'إدارة الجرد وحركات المخزون', desc: 'تطبيق تسويات الجرد الفعلي، التحويلات بين المخازن، وحركات الإدخال والإخراج.', category: 'المخازن ومواقع التخزين' },
  'Permissions.ViewInventory': { label: 'عرض حركات وأرصدة المخزون', desc: 'متابعة أرصدة الأصناف الحالية والاطلاع على كشوفات حساب حركة كرت الصنف.', category: 'المخازن ومواقع التخزين' },
  'Permissions.ViewProductionBatches': { label: 'استعراض سجل دفعات التصنيع', desc: 'عرض ومتابعة الدفعات الإنتاجية المجدولة ومراحل التنفيذ الخاصة بها.', category: 'التصنيع والإنتاج والتشغيل' },
  'Permissions.CreateProductionBatch': { label: 'تخطيط وجدولة دفعات التصنيع', desc: 'تحديد كميات المواد المصنعة والمكونات وجدولة بداية عمليات الإنتاج.', category: 'التصنيع والإنتاج والتشغيل' },
  'Permissions.UpdateProductionBatch': { label: 'تعديل حالات دفعات التصنيع', desc: 'ترقية خطة الإنتاج (من مخطط إلى قيد التشغيل أو مكتمل وإيداع المنتج بالمخازن).', category: 'التصنيع والإنتاج والتشغيل' },
  'Permissions.DeleteProductionBatch': { label: 'إلغاء دفعات التصنيع المخططة', desc: 'حذف سجلات الدفعات الإنتاجية التي لم تبدأ بعد.', category: 'التصنيع والإنتاج والتشغيل' }
}

export default function PermissionsPage({ navigate }: PermissionsProps) {
  const [permissions, setPermissions] = useState<string[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [errorNotice, setErrorNotice] = useState<string | null>(null)

  useEffect(() => {
    const loadPermissions = async () => {
      setLoading(true)
      setErrorNotice(null)
      try {
        const perms = await rolesApi.catalogue()
        setPermissions(perms)
      } catch (err) {
        setErrorNotice(err instanceof Error ? err.message : 'تعذر تحميل قائمة الصلاحيات من السيرفر.')
      } finally {
        setLoading(false)
      }
    }
    void loadPermissions()
  }, [])

  // Filter permissions based on search query
  const filteredPermissions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return permissions
    return permissions.filter(perm => {
      const details = permissionDetails[perm]
      return (
        perm.toLowerCase().includes(q) ||
        (details && (
          details.label.toLowerCase().includes(q) ||
          details.desc.toLowerCase().includes(q) ||
          details.category.toLowerCase().includes(q)
        ))
      )
    })
  }, [permissions, searchQuery])

  // Group filtered permissions by category
  const groupedPermissions = useMemo(() => {
    const categories: Record<string, string[]> = {}
    filteredPermissions.forEach(perm => {
      const cat = permissionDetails[perm]?.category || 'أخرى'
      if (!categories[cat]) categories[cat] = []
      categories[cat].push(perm)
    })
    return categories
  }, [filteredPermissions])

  return (
    <DashboardLayout navigate={navigate}>
      <div className="ss-container animate-fade-in" style={{ paddingBottom: '3rem' }}>
        <div className="ss-page-header">
          <div>
            <p className="ss-page-kicker">تهيئة الأمان المرجعية</p>
            <h1 className="ss-page-title">دليل صلاحيات النظام</h1>
            <p className="ss-page-sub">دليل تعريفي بكافة الصلاحيات المتاحة في قاعدة البيانات للتحكم في الوصول إلى شاشات ومميزات لوحة التحكم.</p>
          </div>
        </div>

        {errorNotice && (
          <div className="ss-status ss-status-error" style={{ marginBottom: '1.5rem' }}>
            <span className="ss-status-icon">⚠️</span>
            <span>{errorNotice}</span>
          </div>
        )}

        <div className="ss-panel" style={{ gap: '1.5rem' }}>
          <div className="responsive-toolbar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
            <span style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)' }}>
              إجمالي الصلاحيات المعرفة بالنظام: <span style={{ color: 'var(--text-primary)', fontWeight: 700 }}>{toArabicNumerals(filteredPermissions.length)}</span> من أصل <span style={{ color: 'var(--text-secondary)' }}>{toArabicNumerals(permissions.length)}</span> صلاحية
            </span>
            <input 
              type="text" 
              placeholder="ابحث عن صلاحية بالاسم أو الوصف أو الكود..." 
              className="ss-input ss-search-input" 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ maxWidth: '320px', width: '100%' }}
              aria-label="البحث في الصلاحيات"
            />
          </div>

          {loading ? (
            <div className="ss-loading-list" style={{ padding: '4rem 0' }}>
              <div className="ss-skeleton-row"><span /><span /><span /></div>
              <div className="ss-skeleton-row"><span /><span /><span /></div>
              <div className="ss-skeleton-row"><span /><span /><span /></div>
            </div>
          ) : filteredPermissions.length === 0 ? (
            <div className="ss-empty-state" style={{ padding: '4rem' }}>
              <div className="ss-empty-mark">🔍</div>
              <h3>لا توجد نتائج مطابقة لبحثك</h3>
              <p>تأكد من كتابة الكلمة بشكل صحيح أو جرب كلمة بحث أخرى.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2.25rem' }}>
              {Object.keys(groupedPermissions).map(categoryName => (
                <div key={categoryName} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {/* Category Banner Title */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
                    <div style={{ width: '6px', height: '18px', background: 'var(--color-accent)', borderRadius: '3px' }} />
                    <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
                      الصلاحيات الخاصة بـ {categoryName}
                    </h2>
                  </div>

                  {/* Grid layout for permissions card in this category */}
                  <div className="auto-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1.25rem' }}>
                    {groupedPermissions[categoryName].map(perm => {
                      const details = permissionDetails[perm] || {
                        label: perm.replace('Permissions.', ''),
                        desc: 'كود صلاحية النظام الفرعية لتوفير الحماية على مستوى واجهة برمجة التطبيقات.'
                      }

                      return (
                        <div 
                          key={perm} 
                          className="metric-card" 
                          style={{ 
                            background: 'var(--bg-primary)', 
                            border: '1px solid var(--border-color)', 
                            borderRadius: '10px',
                            display: 'flex', 
                            flexDirection: 'column', 
                            justifyContent: 'space-between', 
                            alignItems: 'stretch',
                            width: '100%',
                            padding: '1.25rem',
                            boxSizing: 'border-box',
                            gap: '0.8rem',
                            boxShadow: '0 2px 4px rgba(0,0,0,0.01)'
                          }}
                        >
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', textAlign: 'right' }}>
                            <span style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)' }}>
                              {details.label}
                            </span>
                            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: '1.5', minHeight: '48px' }}>
                              {details.desc}
                            </span>
                          </div>
                          
                          <div style={{ borderTop: '1px dotted var(--border-color)', paddingTop: '0.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: '0.7rem', fontFamily: 'monospace', color: 'var(--text-muted)' }}>
                              {perm}
                            </span>
                            <span style={{ fontSize: '0.7rem', background: 'var(--bg-secondary)', color: 'var(--text-primary)', padding: '1px 6px', borderRadius: '3px', fontWeight: 600 }}>
                              نشطة بالسيستم
                            </span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  )
}
