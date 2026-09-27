import { useCallback, useEffect, useState } from 'react'
import DashboardLayout from '../../components/DashboardLayout/DashboardLayout'
import { purchasingApi, type Vendor } from '../../lib/api'
import { Button, EmptyState, LoadingState, ListToolbar, ModuleHeading, StatusBanner, UsersIcon, PlusIcon, RowActions, type Notice } from '../shared/ManagementUi'
import '../SystemSettings/SystemSettings.css'

interface ConsignmentVendorsProps {
  navigate: (path: string) => void
}

const fmt = (v: number) => v.toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const emptyForm = { name: '', contactPerson: '', phoneNumber: '', email: '', address: '', taxNumber: '', notes: '', commissionRate: 0, isActive: true }

export default function ConsignmentVendors({ navigate }: ConsignmentVendorsProps) {
  const [items, setItems] = useState<Vendor[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Vendor | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async (showLoader = true) => {
    if (showLoader) setLoading(true)
    try {
      const page = await purchasingApi.listVendors({ kind: 'CONSIGNMENT', pageSize: 100 })
      setItems(page.items)
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'تعذر تحميل موردي الأمانة.' })
    } finally { setLoading(false) }
  }, [query])

  useEffect(() => { void load() }, [load])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setNotice(null)
    try {
      if (editing) await purchasingApi.updateVendor(editing.id, form)
      else await purchasingApi.createVendor({ kind: 'CONSIGNMENT', ...form })
      setFormOpen(false); setEditing(null); setForm(emptyForm)
      await load(false)
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'تعذر الحفظ.' })
    } finally { setSaving(false) }
  }

  const remove = async (item: Vendor) => {
    if (!window.confirm('تأكيد حذف ' + item.name + '؟')) return
    try {
      await purchasingApi.deleteVendor(item.id)
      await load(false)
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'تعذر الحذف.' })
    }
  }

  return (
    <DashboardLayout navigate={navigate}>
      <div className="view-container">
        <section className="ss-module animate-fade-in">
          <ModuleHeading icon={<UsersIcon />} eyebrow="المشتريات" title="موردين الأمانة" subtitle="إدارة موردي الأمانة ونسب العمولة والأرصدة." />
          <div className="ss-module-actions">
            <span className="ss-count-chip"><strong>{items.length}</strong> مورد</span>
            <Button variant="primary" onClick={() => { setFormOpen(true); setEditing(null); setForm(emptyForm) }}><PlusIcon /> مورد جديد</Button>
            <Button variant="ghost" onClick={() => void load()} disabled={loading}>تحديث</Button>
          </div>
          <StatusBanner notice={notice} />
          {formOpen && (
            <form onSubmit={submit} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem', padding: '1rem', border: '1px solid var(--border-color)', borderRadius: '10px', marginBottom: '1rem' }}>
              <input className="ss-input" placeholder="الاسم" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
              <input className="ss-input" placeholder="مسؤول التواصل" value={form.contactPerson} onChange={e => setForm(f => ({ ...f, contactPerson: e.target.value }))} />
              <input className="ss-input" placeholder="رقم الهاتف" value={form.phoneNumber} onChange={e => setForm(f => ({ ...f, phoneNumber: e.target.value }))} />
              <input className="ss-input" type="email" placeholder="البريد الإلكتروني" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
              <input className="ss-input" placeholder="العنوان" value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} />
              <input className="ss-input" placeholder="الرقم الضريبي" value={form.taxNumber} onChange={e => setForm(f => ({ ...f, taxNumber: e.target.value }))} style={{ direction: 'ltr' }} />
              <input className="ss-input" placeholder="ملاحظات" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
              <input className="ss-input" type="number" min="0" max="100" step="0.01" placeholder="نسبة العمولة %" value={form.commissionRate} onChange={e => setForm(f => ({ ...f, commissionRate: Number(e.target.value) }))} />
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <input type="checkbox" checked={form.isActive} onChange={e => setForm(f => ({ ...f, isActive: e.target.checked }))} /> نشط
              </label>
              <Button variant="primary" type="submit" disabled={saving}>{saving ? 'جاري الحفظ...' : 'حفظ'}</Button>
            </form>
          )}
          <div className="ss-list-toolbar">
            <ListToolbar query={query} setQuery={setQuery} placeholder="ابحث باسم المورد..." lastLoaded={null} />
          </div>
          <div className="ss-data-surface">
            {loading ? <LoadingState /> : items.length === 0 ? <EmptyState hasSearch={Boolean(query.trim())} /> : (
              <div className="ss-table-scroll">
                <table className="ss-table">
                  <thead><tr><th>#</th><th>الاسم</th><th>مسؤول التواصل</th><th>الهاتف</th><th>البريد</th><th>العنوان</th><th>الرقم الضريبي</th><th>العمولة</th><th>الحالة</th><th>أوامر الشراء</th><th>إجراءات</th></tr></thead>
                  <tbody>
                    {items.map((item, index) => (
                      <tr key={item.id}>
                        <td>{index + 1}</td>
                        <td>{item.name}</td>
                        <td>{item.contactPerson || '—'}</td>
                        <td>{item.phoneNumber || '—'}</td>
                        <td>{item.email || '—'}</td>
                        <td>{item.address || '—'}</td>
                        <td><span dir="ltr">{item.taxNumber || '—'}</span></td>
                        <td>{fmt(Number(item.commissionRate))}%</td>
                        <td>{item.isActive ? 'نشط' : 'موقوف'}</td>
                        <td>{item._count?.purchaseOrders ?? '—'}</td>
                        <td>
                          <RowActions
                            onEdit={() => { setFormOpen(true); setEditing(item); setForm({ name: item.name, contactPerson: item.contactPerson, phoneNumber: item.phoneNumber, email: item.email, address: item.address ?? '', taxNumber: item.taxNumber ?? '', notes: item.notes ?? '', commissionRate: Number(item.commissionRate), isActive: item.isActive }) }}
                            onDelete={() => void remove(item)}
                            saving={saving}
                            name={item.name}
                          />
                        </td>
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
