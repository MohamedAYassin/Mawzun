import { useEffect, useState, useMemo, useCallback, type FormEvent } from 'react'
import DashboardLayout from '../../components/DashboardLayout/DashboardLayout'
import { rolesApi, type Role } from '../../lib/api'
import { toArabicNumerals } from '../../utils/arabicNumerals'
import '../SystemSettings/SystemSettings.css'

interface RolesProps {
  navigate: (path: string) => void
}

const permissionLabels: Record<string, { label: string; category: string }> = {
  'Permissions.ManageUsers': { label: 'إدارة المستخدمين وحظرهم', category: 'المستخدمين والأمن' },
  'Permissions.ManageRoles': { label: 'إدارة الأدوار وصلاحيات المجموعات', category: 'المستخدمين والأمن' },
  'Permissions.ViewProducts': { label: 'استعراض المنتجات', category: 'المنتجات' },
  'Permissions.CreateProduct': { label: 'إضافة منتج جديد', category: 'المنتجات' },
  'Permissions.UpdateProduct': { label: 'تعديل بيانات المنتج', category: 'المنتجات' },
  'Permissions.DeleteProduct': { label: 'حذف المنتجات', category: 'المنتجات' },
  'Permissions.ViewOrders': { label: 'استعراض الطلبات والتقارير', category: 'الطلبات والمالية' },
  'Permissions.CreateOrder': { label: 'إنشاء طلبات مبيعات ومشتريات', category: 'الطلبات والمالية' },
  'Permissions.UpdateOrder': { label: 'تعديل الطلبات', category: 'الطلبات والمالية' },
  'Permissions.DeleteOrder': { label: 'حذف الطلبات', category: 'الطلبات والمالية' },
  'Permissions.ViewCustomers': { label: 'استعراض العملاء', category: 'العملاء' },
  'Permissions.CreateCustomer': { label: 'إضافة عميل جديد', category: 'العملاء' },
  'Permissions.UpdateCustomer': { label: 'تعديل بيانات العميل', category: 'العملاء' },
  'Permissions.DeleteCustomer': { label: 'حذف العملاء', category: 'العملاء' },
  'Permissions.ViewCategories': { label: 'استعراض الأقسام وتصنيفاتها', category: 'إعدادات النظام' },
  'Permissions.CreateCategory': { label: 'إضافة قسم جديد', category: 'إعدادات النظام' },
  'Permissions.UpdateCategory': { label: 'تعديل بيانات القسم', category: 'إعدادات النظام' },
  'Permissions.DeleteCategory': { label: 'حذف القسم', category: 'إعدادات النظام' },
  'Permissions.ViewBrands': { label: 'استعراض الماركات التجارية', category: 'إعدادات النظام' },
  'Permissions.CreateBrand': { label: 'إضافة ماركة جديدة', category: 'إعدادات النظام' },
  'Permissions.UpdateBrand': { label: 'تعديل بيانات الماركة', category: 'إعدادات النظام' },
  'Permissions.DeleteBrand': { label: 'حذف الماركة', category: 'إعدادات النظام' },
  'Permissions.ViewWarehouses': { label: 'استعراض المستودعات والمخازن', category: 'المخازن والمواقع' },
  'Permissions.CreateWarehouse': { label: 'إضافة مستودع جديد', category: 'المخازن والمواقع' },
  'Permissions.UpdateWarehouse': { label: 'تعديل بيانات المستودع', category: 'المخازن والمواقع' },
  'Permissions.DeleteWarehouse': { label: 'حذف المستودع', category: 'المخازن والمواقع' },
  'Permissions.ViewStorageLocations': { label: 'استعراض مواقع التخزين الداخلية', category: 'المخازن والمواقع' },
  'Permissions.CreateStorageLocation': { label: 'إضافة موقع تخزين داخلي', category: 'المخازن والمواقع' },
  'Permissions.UpdateStorageLocation': { label: 'تعديل بيانات موقع التخزين', category: 'المخازن والمواقع' },
  'Permissions.DeleteStorageLocation': { label: 'حذف موقع التخزين', category: 'المخازن والمواقع' },
  'Permissions.ManageSettings': { label: 'إدارة إعدادات النظام المرجعية', category: 'إعدادات النظام' },
  'Permissions.ChangeOrderItemPrice': { label: 'تعديل أسعار المنتجات الفردية في الفاتورة', category: 'الطلبات والمالية' },
  'Permissions.ManageInventory': { label: 'إجراء حركات المخزن وتعديل الكميات والجرد', category: 'المخازن والمواقع' },
  'Permissions.ViewInventory': { label: 'استعراض أرصدة المخازن وسجلات الحركات الجردية', category: 'المخازن والمواقع' },
  'Permissions.ViewProductionBatches': { label: 'استعراض دفعات الإنتاج والتصنيع', category: 'التصنيع والإنتاج' },
  'Permissions.CreateProductionBatch': { label: 'جدولة دفعات تصنيع جديدة', category: 'التصنيع والإنتاج' },
  'Permissions.UpdateProductionBatch': { label: 'تحديث دفعات الإنتاج وتعديل حالاتها', category: 'التصنيع والإنتاج' },
  'Permissions.DeleteProductionBatch': { label: 'حذف خطط الإنتاج المجدولة', category: 'التصنيع والإنتاج' }
}

export default function Roles({ navigate }: RolesProps) {
  const [paginatedData, setPaginatedData] = useState<{ page: number; pageSize: number; totalPages: number; total: number; items: Role[] }>({ page: 1, pageSize: 20, totalPages: 0, total: 0, items: [] })
  const [availablePermissions, setAvailablePermissions] = useState<string[]>([])
  const [searchQuery, setSearchQuery] = useState('')

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [errorNotice, setErrorNotice] = useState<string | null>(null)
  const [successNotice, setSuccessNotice] = useState<string | null>(null)

  const [formOpen, setFormOpen] = useState(false)
  const [editingGroup, setEditingGroup] = useState<Role | null>(null)
  const [roleName, setRoleName] = useState('')
  const [roleDescription, setRoleDescription] = useState<string>('')
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([])

  const loadData = useCallback(async (page: number, search: string) => {
    setLoading(true)
    setErrorNotice(null)
    try {
      const [paginated, perms] = await Promise.all([
        rolesApi.list({ page, pageSize: 10, search: search || undefined }),
        rolesApi.catalogue()
      ])
      setPaginatedData({ page: paginated.page, pageSize: paginated.pageSize, totalPages: paginated.totalPages, total: paginated.total, items: paginated.items })
      setAvailablePermissions(perms)
    } catch (err) {
      setErrorNotice(err instanceof Error ? err.message : 'تعذر تحميل بيانات الأدوار والصلاحيات.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadData(1, '')
  }, [loadData])

  const permissionsByCategory = useMemo(() => {
    const categories: Record<string, string[]> = {}
    availablePermissions.forEach(perm => {
      const catName = permissionLabels[perm]?.category || 'أخرى'
      if (!categories[catName]) categories[catName] = []
      categories[catName].push(perm)
    })
    return categories
  }, [availablePermissions])

  const openCreateForm = () => {
    setEditingGroup(null)
    setRoleName('')
      setRoleDescription('')
    setSelectedPermissions([])
    setFormOpen(true)
    setErrorNotice(null)
    setSuccessNotice(null)
  }

  const openEditForm = (group: Role) => {
    setEditingGroup(group)
    setRoleName(group.name)
      setRoleDescription(group.description ?? '')
    setSelectedPermissions(group.permissions.map(p => p.permissionKey))
    setFormOpen(true)
    setErrorNotice(null)
    setSuccessNotice(null)
  }

  const closeForm = () => {
    setFormOpen(false)
    setEditingGroup(null)
    setRoleName('')
      setRoleDescription('')
    setSelectedPermissions([])
  }

  const togglePermission = (permission: string) => {
    setSelectedPermissions(prev =>
      prev.includes(permission)
        ? prev.filter(p => p !== permission)
        : [...prev, permission]
    )
  }

  const toggleCategoryPermissions = (categoryPerms: string[], checked: boolean) => {
    setSelectedPermissions(prev => {
      const filtered = prev.filter(p => !categoryPerms.includes(p))
      return checked ? [...filtered, ...categoryPerms] : filtered
    })
  }

  const goToPage = (page: number) => {
    void loadData(page, searchQuery)
  }

  const handleSearchChange = (value: string) => {
    setSearchQuery(value)
    void loadData(1, value)
  }

  const handleFormSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const name = roleName.trim()
    if (!name) {
      setErrorNotice('يرجى إدخال اسم الدور الوظيفي.')
      return
    }

    setSaving(true)
    setErrorNotice(null)
    setSuccessNotice(null)

    try {
      if (editingGroup) {
        await rolesApi.update(editingGroup.id, {
          name: editingGroup.isSystem ? editingGroup.name : name,
          description: roleDescription.trim() || null,
          permissionKeys: selectedPermissions
        })
        setSuccessNotice('تم تحديث صلاحيات الدور بنجاح.')
      } else {
        await rolesApi.create({
          name,
          description: roleDescription.trim() || null,
          permissionKeys: selectedPermissions
        })
        setSuccessNotice('تم إنشاء الدور الوظيفي الجديد بنجاح.')
      }
      closeForm()
      void loadData(paginatedData.page, searchQuery)
    } catch (err) {
      setErrorNotice(err instanceof Error ? err.message : 'تعذر حفظ تعديلات الدور الوظيفي.')
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteGroup = async (group: Role) => {
    if (group.isSystem) {
      setErrorNotice('لا يمكن حذف دور مدير النظام الرئيسي (Admin).')
      return
    }

    if (!window.confirm(`هل أنت متأكد من رغبتك في حذف الدور «${group.name}» نهائياً؟`)) {
      return
    }

    setSaving(true)
    setErrorNotice(null)
    setSuccessNotice(null)

    try {
      await rolesApi.remove(group.id)
      setSuccessNotice('تم حذف الدور الوظيفي بنجاح.')
      void loadData(paginatedData.page, searchQuery)
    } catch (err) {
      setErrorNotice(err instanceof Error ? err.message : 'تعذر إتمام عملية حذف الدور.')
    } finally {
      setSaving(false)
    }
  }

  const { page, totalPages, total: totalEntries, items: roleGroups } = paginatedData

  return (
    <DashboardLayout navigate={navigate}>
      <div className="ss-container animate-fade-in" style={{ paddingBottom: '3rem' }}>
        <div className="ss-page-header">
          <div>
            <p className="ss-page-kicker">إدارة الحماية والصلاحيات</p>
            <h1 className="ss-page-title">أدوار ومجموعات صلاحيات الموظفين</h1>
            <p className="ss-page-sub">حدد الأدوار الوظيفية المختلفة ومجموعة الصلاحيات المخصصة لكل دور لتأمين النظام ومتابعة المهام.</p>
          </div>
        </div>

        {errorNotice && (
          <div className="ss-status ss-status-error" style={{ marginBottom: '1.5rem' }}>
            <span className="ss-status-icon">⚠️</span>
            <span>{errorNotice}</span>
          </div>
        )}

        {successNotice && (
          <div className="ss-status ss-status-success" style={{ marginBottom: '1.5rem' }}>
            <span className="ss-status-icon">✓</span>
            <span>{successNotice}</span>
          </div>
        )}

        {loading ? (
          <div className="ss-loading-list" style={{ padding: '4rem 0' }}>
            <div className="ss-skeleton-row"><span /><span /><span /></div>
            <div className="ss-skeleton-row"><span /><span /><span /></div>
            <div className="ss-skeleton-row"><span /><span /><span /></div>
          </div>
        ) : (
          <div className="ss-panel" style={{ gap: '1.5rem' }}>
            <div className="responsive-toolbar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <span style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                  مجموعات الأدوار المعرفة بالسيستم: <span style={{ color: 'var(--text-primary)', fontWeight: 700 }}>{toArabicNumerals(totalEntries)}</span> أدوار
                </span>
                <input
                  type="text"
                  placeholder="ابحث عن دور..."
                  className="ss-input ss-search-input"
                  value={searchQuery}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  style={{ maxWidth: '240px', width: '100%' }}
                  aria-label="البحث في الأدوار"
                />
              </div>
              <button
                onClick={openCreateForm}
                className="ss-btn-save"
                style={{
                  fontSize: '0.8rem',
                  padding: '0.5rem 1.25rem',
                  backgroundColor: 'var(--color-accent)',
                  color: 'var(--color-accent-contrast)',
                  border: 'none',
                  borderRadius: 'var(--radius-md)',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                + إضافة دور جديد
              </button>
            </div>

            <div className="auto-grid-lg" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1.5rem' }}>
              {roleGroups.map(group => (
                <div
                  key={group.id}
                  className="metric-card"
                  style={{
                    background: 'var(--bg-primary)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '12px',
                    padding: '1.5rem',
                    boxSizing: 'border-box',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    gap: '1.25rem',
                    minHeight: '260px',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.02)'
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', textAlign: 'right' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontWeight: 700, fontSize: '1.1rem', color: 'var(--text-primary)' }}>
                        {group.name === 'Admin' ? 'مدير النظام الرئيسي (Admin)' : group.name}
                      </span>
                      <span style={{ fontSize: '0.8rem', background: 'var(--bg-secondary)', padding: '2px 8px', borderRadius: '4px', color: 'var(--text-primary)', fontWeight: 600 }}>
                        {toArabicNumerals(group.permissions.length)} صلاحيات
                      </span>
                      <span style={{ fontSize: '0.8rem', background: 'var(--bg-secondary)', padding: '2px 8px', borderRadius: '4px', color: 'var(--text-primary)', fontWeight: 600 }}>
                        {toArabicNumerals(group._count?.users ?? 0)} مستخدمين
                      </span>
                    </div>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                      {group.description || (group.name === 'Admin'
                        ? 'يمتلك هذا الدور كامل الصلاحيات لإدارة النظام والتحكم المطلق بكافة البيانات المرجعية وحسابات المستخدمين.'
                        : `مجموعة صلاحيات مخصصة للعمليات التشغيلية تحت مسمى «${group.name}».`)}
                    </span>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', textAlign: 'right' }}>الصلاحيات الممنوحة:</span>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', direction: 'rtl', maxHeight: '90px', overflowY: 'auto', padding: '4px 0' }}>
                      {group.permissions.length === 0 ? (
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>لا توجد صلاحيات معطاة بعد</span>
                      ) : (
                        group.permissions.map((perm, idx) => (
                          <span
                            key={idx}
                            style={{
                              fontSize: '0.7rem',
                              background: 'rgba(139, 90, 43, 0.06)',
                              color: 'var(--text-primary)',
                              padding: '3px 8px',
                              borderRadius: '4px',
                              fontWeight: 500,
                              whiteSpace: 'nowrap'
                            }}
                            title={perm.permissionKey}
                          >
                            {permissionLabels[perm.permissionKey]?.label || perm.permissionKey}
                          </span>
                        ))
                      )}
                    </div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.8rem', borderTop: '1px solid var(--border-color)', paddingTop: '0.8rem', marginTop: '0.25rem' }}>
                    {group.name !== 'Admin' && (
                      <button
                        onClick={() => void handleDeleteGroup(group)}
                        disabled={saving}
                        className="forgot-btn"
                        style={{ fontSize: '0.8rem', textDecoration: 'none', color: 'var(--color-danger)', border: 'none', background: 'none', cursor: 'pointer' }}
                      >
                        حذف الدور
                      </button>
                    )}
                    <button
                      onClick={() => openEditForm(group)}
                      className="forgot-btn"
                      style={{ fontSize: '0.8rem', textDecoration: 'none', color: 'var(--text-primary)', border: 'none', background: 'none', cursor: 'pointer', fontWeight: 600 }}
                    >
                      تعديل الصلاحيات ←
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {totalPages > 1 && (
              <div className="pagination-bar" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem', paddingTop: '1rem', borderTop: '1px solid var(--border-color)', marginTop: '0.5rem' }}>
                <button
                  onClick={() => goToPage(page - 1)}
                  disabled={page <= 1}
                  style={{
                    padding: '0.4rem 0.9rem',
                    border: '1px solid var(--border-color)',
                    borderRadius: 'var(--radius-md)',
                    background: page <= 1 ? 'var(--bg-secondary)' : 'var(--bg-primary)',
                    color: page <= 1 ? 'var(--text-muted)' : 'var(--text-primary)',
                    cursor: page <= 1 ? 'default' : 'pointer',
                    fontSize: '0.8rem',
                    fontWeight: 600
                  }}
                >
                  ← السابق
                </button>
                {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                  let pageNum: number
                  if (totalPages <= 7) {
                    pageNum = i + 1
                  } else if (page <= 4) {
                    pageNum = i + 1
                  } else if (page >= totalPages - 3) {
                    pageNum = totalPages - 6 + i
                  } else {
                    pageNum = page - 3 + i
                  }
                  return (
                    <button
                      key={pageNum}
                      onClick={() => goToPage(pageNum)}
                      style={{
                        padding: '0.4rem 0.75rem',
                        border: 'none',
                        borderRadius: 'var(--radius-md)',
                        background: pageNum === page ? 'var(--text-primary)' : 'transparent',
                        color: pageNum === page ? 'var(--color-accent-contrast)' : 'var(--text-secondary)',
                        cursor: 'pointer',
                        fontSize: '0.8rem',
                        fontWeight: pageNum === page ? 700 : 500,
                        minWidth: '32px'
                      }}
                    >
                      {toArabicNumerals(pageNum)}
                    </button>
                  )
                })}
                <button
                  onClick={() => goToPage(page + 1)}
                  disabled={page >= totalPages}
                  style={{
                    padding: '0.4rem 0.9rem',
                    border: '1px solid var(--border-color)',
                    borderRadius: 'var(--radius-md)',
                    background: page >= totalPages ? 'var(--bg-secondary)' : 'var(--bg-primary)',
                    color: page >= totalPages ? 'var(--text-muted)' : 'var(--text-primary)',
                    cursor: page >= totalPages ? 'default' : 'pointer',
                    fontSize: '0.8rem',
                    fontWeight: 600
                  }}
                >
                  التالي →
                </button>
              </div>
            )}
          </div>
        )}

        {formOpen && (
          <div className="ss-multi-editor-overlay animate-fade-in" style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.4)',
            display: 'flex',
            justifyContent: 'flex-end',
            zIndex: 1000,
            direction: 'rtl'
          }}>
            <form
              onSubmit={handleFormSubmit}
              className="ss-multi-editor"
              style={{
                background: 'var(--bg-primary)',
                width: '100%',
                maxWidth: '560px',
                height: '100%',
                boxShadow: '-5px 0 25px rgba(0,0,0,0.15)',
                display: 'flex',
                flexDirection: 'column',
                padding: '2.25rem',
                boxSizing: 'border-box',
                overflowY: 'auto'
              }}
            >
              <div style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '1rem', marginBottom: '1.5rem' }}>
                <span className="ss-editor-kicker" style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{editingGroup ? 'تحرير الصلاحيات' : 'دور وظيفي جديد'}</span>
                <h3 style={{ margin: '0.25rem 0 0 0', color: 'var(--text-primary)', fontSize: '1.35rem', fontWeight: 700 }}>
                  {editingGroup ? `تعديل الدور «${editingGroup.name}»` : 'إضافة دور وظيفي جديد'}
                </h3>
              </div>

              <div className="ss-editor-field" style={{ marginBottom: '1.5rem' }}>
                <label htmlFor="role-name-input" style={{ fontWeight: 600, display: 'block', marginBottom: '0.5rem' }}>اسم الدور الوظيفي</label>
                <input
                  id="role-name-input"
                  type="text"
                  className="ss-input"
                  value={roleName}
                  onChange={(e) => setRoleName(e.target.value)}
                  placeholder="مثال: مسؤول مبيعات خارجي، مدير المخزن الفرعي"
                  disabled={saving || (editingGroup?.name === 'Admin')}
                  style={{ width: '100%', boxSizing: 'border-box' }}
                  required
                />
                {editingGroup?.name === 'Admin' && (
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '4px', display: 'block' }}>لا يمكن تغيير اسم دور المدير الرئيسي لضمان تكامل النظام.</span>
                )}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <label htmlFor="role-description-input" style={{ fontSize: '0.85rem', fontWeight: 600 }}>وصف الدور</label>
                <input
                  id="role-description-input"
                  type="text"
                  className="ss-input"
                  value={roleDescription}
                  onChange={(e) => setRoleDescription(e.target.value)}
                  placeholder="مثال: صلاحيات فريق المبيعات"
                  disabled={saving}
                />
              </div>

              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '1.5rem', marginBottom: '1.5rem' }}>
                <label style={{ fontWeight: 600, display: 'block' }}>تحديد الصلاحيات الممنوحة لهذا الدور</label>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', maxHeight: '420px', overflowY: 'auto', paddingLeft: '8px' }}>
                  {Object.keys(permissionsByCategory).map(categoryName => {
                    const categoryPerms = permissionsByCategory[categoryName]
                    const allCheckedInCat = categoryPerms.every(p => selectedPermissions.includes(p))

                    return (
                      <div
                        key={categoryName}
                        style={{
                          border: '1px solid var(--border-color)',
                          borderRadius: '8px',
                          padding: '1rem',
                          background: 'var(--bg-secondary)'
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem', marginBottom: '0.8rem' }}>
                          <span style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--text-primary)' }}>{categoryName}</span>
                          <button
                            type="button"
                            onClick={() => toggleCategoryPermissions(categoryPerms, !allCheckedInCat)}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: 'var(--text-secondary)',
                              fontSize: '0.8rem',
                              cursor: 'pointer',
                              fontWeight: 600
                            }}
                          >
                            {allCheckedInCat ? 'إلغاء تحديد الكل' : 'تحديد الكل'}
                          </button>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          {categoryPerms.map(perm => (
                            <label
                              key={perm}
                              style={{
                                display: 'flex',
                                alignItems: 'flex-start',
                                gap: '8px',
                                fontSize: '0.8rem',
                                color: 'var(--text-primary)',
                                cursor: 'pointer'
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={selectedPermissions.includes(perm)}
                                onChange={() => togglePermission(perm)}
                                disabled={saving}
                                style={{ marginTop: '2px', cursor: 'pointer' }}
                              />
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
                                <span>{permissionLabels[perm]?.label || perm}</span>
                                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{perm}</span>
                              </div>
                            </label>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.8rem', borderTop: '1px solid var(--border-color)', paddingTop: '1.25rem' }}>
                <button
                  type="button"
                  onClick={closeForm}
                  disabled={saving}
                  style={{
                    padding: '0.6rem 1.5rem',
                    background: 'none',
                    border: '1px solid var(--border-color)',
                    borderRadius: 'var(--radius-md)',
                    cursor: 'pointer',
                    fontSize: '0.85rem',
                    fontWeight: 600
                  }}
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  style={{
                    padding: '0.6rem 1.5rem',
                    background: 'var(--color-accent)',
                    color: 'var(--color-accent-contrast)',
                    border: 'none',
                    borderRadius: 'var(--radius-md)',
                    cursor: 'pointer',
                    fontSize: '0.85rem',
                    fontWeight: 600
                  }}
                >
                  {saving ? 'جاري الحفظ...' : editingGroup ? 'حفظ التعديلات' : 'إضافة الدور'}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}
