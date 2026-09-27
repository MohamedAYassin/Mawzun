import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import DashboardLayout from '../../components/DashboardLayout/DashboardLayout'
import { purchasingApi, type Vendor } from '../../lib/api'
import { ModuleHeading, ModuleActions, StatusBanner, ListToolbar, LoadingState, EmptyState, EditorHeader, EditorActions, RowActions, ActiveBadge, TruckIcon, type Notice } from '../shared/ManagementUi'
import '../SystemSettings/SystemSettings.css'

interface VendorsManagementProps {
  navigate: (path: string) => void
}

function VendorsTab() {
  const [items, setItems] = useState<Vendor[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Vendor | null>(null)
  const [name, setName] = useState('')
  const [contactPerson, setContactPerson] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [address, setAddress] = useState('')
  const [taxNumber, setTaxNumber] = useState('')
  const [commissionRate, setCommissionRate] = useState('')
  const [notes, setNotes] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [lastLoaded, setLastLoaded] = useState<Date | null>(null)

  const load = useCallback(async (showLoader = true) => {
    if (showLoader) setLoading(true)
    try {
      const page = await purchasingApi.listVendors({ kind: 'SUPPLIER', pageSize: 200 })
      setItems(page.items)
      setLastLoaded(new Date())
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'تعذر تحميل الموردين.' })
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load])

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter((item) => item.name.toLowerCase().includes(q) || item.phoneNumber.includes(q) || item.email.toLowerCase().includes(q))
  }, [items, query])

  const startAdd = () => { setEditing(null); setName(''); setContactPerson(''); setPhone(''); setEmail(''); setAddress(''); setTaxNumber(''); setCommissionRate(''); setNotes(''); setIsActive(true); setFormOpen(true); setNotice(null) }
  const startEdit = (item: Vendor) => {
    setEditing(item); setName(item.name); setContactPerson(item.contactPerson || ''); setPhone(item.phoneNumber); setEmail(item.email); setAddress(item.address); setTaxNumber(item.taxNumber || ''); setCommissionRate(item.commissionRate != null ? String(item.commissionRate) : ''); setNotes(item.notes); setIsActive(item.isActive); setFormOpen(true); setNotice(null)
  }
  const closeForm = () => { setFormOpen(false); setEditing(null); setName(''); setContactPerson(''); setPhone(''); setEmail(''); setAddress(''); setTaxNumber(''); setCommissionRate(''); setNotes(''); setIsActive(true) }

  const buildDto = () => ({ kind: 'SUPPLIER' as const, name: name.trim(), contactPerson: contactPerson.trim(), phoneNumber: phone.trim(), email: email.trim(), address: address.trim(), taxNumber: taxNumber.trim() || null, commissionRate: commissionRate.trim() === '' ? 0 : Number(commissionRate), notes: notes.trim(), isActive })

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim()) { setNotice({ type: 'error', text: 'يرجى إدخال اسم المورد.' }); return }
    setSaving(true); setNotice(null)
    try {
      if (editing) {
        await purchasingApi.updateVendor(editing.id, buildDto())
        setNotice({ type: 'success', text: 'تم تحديث المورد بنجاح.' })
      } else {
        await purchasingApi.createVendor(buildDto())
        setNotice({ type: 'success', text: 'تمت إضافة المورد بنجاح.' })
      }
      closeForm(); await load(false)
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'تعذر حفظ البيانات.' })
    } finally { setSaving(false) }
  }

  const remove = async (item: Vendor) => {
    if (!window.confirm(`هل أنت متأكد من حذف المورد «${item.name}»؟`)) return
    setSaving(true); setNotice(null)
    try {
      await purchasingApi.deleteVendor(item.id)
      setNotice({ type: 'success', text: 'تم حذف المورد بنجاح.' })
      if (editing?.id === item.id) closeForm()
      await load(false)
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'تعذر حذف المورد.' })
    } finally { setSaving(false) }
  }

  return { items, filteredItems, query, setQuery, loading, saving, formOpen, editing, name, setName, contactPerson, setContactPerson, phone, setPhone, email, setEmail, address, setAddress, taxNumber, setTaxNumber, commissionRate, setCommissionRate, notes, setNotes, isActive, setIsActive, notice, lastLoaded, load, startAdd, startEdit, closeForm, submit, remove }
}

function VendorsView() {
  const t = VendorsTab()
  return (
    <section className="ss-module animate-fade-in">
      <ModuleHeading icon={<TruckIcon />} eyebrow="المشتريات" title="الموردون (Vendors)" subtitle="إدارة الموردين الذين تشتري منهم المنتجات لأوامر الشراء." />
      <ModuleActions count={t.items.length} countLabel="مورد" onRefresh={() => void t.load()} loading={t.loading} saving={t.saving} onAdd={t.startAdd} addLabel="إضافة مورد" />
      <StatusBanner notice={t.notice} />
      <ListToolbar query={t.query} setQuery={t.setQuery} placeholder="ابحث بالاسم أو الهاتف أو البريد..." lastLoaded={t.lastLoaded} />
      {t.formOpen && (
        <form className="ss-multi-editor" onSubmit={t.submit}>
          <EditorHeader editing={!!t.editing} singular="المورد" />
          <div className="ss-editor-field">
            <label htmlFor="vendor-name">اسم المورد</label>
            <input id="vendor-name" className="ss-input" value={t.name} onChange={(event) => t.setName(event.target.value)} placeholder="اسم المورد / الشركة" autoFocus disabled={t.saving} />
          </div>
          <div className="ss-editor-field">
            <label htmlFor="vendor-phone">رقم الهاتف</label>
            <input id="vendor-phone" className="ss-input" value={t.phone} onChange={(event) => t.setPhone(event.target.value)} placeholder="اختياري" disabled={t.saving} />
          </div>
          <div className="ss-editor-field">
            <label htmlFor="vendor-email">البريد الإلكتروني</label>
            <input id="vendor-email" className="ss-input" value={t.email} onChange={(event) => t.setEmail(event.target.value)} placeholder="اختياري" disabled={t.saving} />
          </div>
          <div className="ss-editor-field">
            <label htmlFor="vendor-address">العنوان</label>
            <input id="vendor-address" className="ss-input" value={t.address} onChange={(event) => t.setAddress(event.target.value)} placeholder="اختياري" disabled={t.saving} />
          </div>
          <div className="ss-editor-field">
            <label htmlFor="vendor-contact">جهة الاتصال</label>
            <input id="vendor-contact" className="ss-input" value={t.contactPerson} onChange={(event) => t.setContactPerson(event.target.value)} placeholder="اختياري" disabled={t.saving} />
          </div>
          <div className="ss-editor-field">
            <label htmlFor="vendor-tax">الرقم الضريبي</label>
            <input id="vendor-tax" className="ss-input" dir="ltr" value={t.taxNumber} onChange={(event) => t.setTaxNumber(event.target.value)} placeholder="اختياري" disabled={t.saving} />
          </div>
          <div className="ss-editor-field">
            <label htmlFor="vendor-commission">العمولة %</label>
            <input id="vendor-commission" className="ss-input" type="number" min="0" step="0.01" value={t.commissionRate} onChange={(event) => t.setCommissionRate(event.target.value)} placeholder="0" disabled={t.saving} />
          </div>
          <div className="ss-editor-field ss-multi-editor-full">
            <label htmlFor="vendor-notes">ملاحظات</label>
            <input id="vendor-notes" className="ss-input" value={t.notes} onChange={(event) => t.setNotes(event.target.value)} placeholder="اختياري" disabled={t.saving} />
          </div>
          <div className="ss-editor-field ss-multi-editor-full">
            <label className="ss-checkbox-label">
              <input type="checkbox" checked={t.isActive} onChange={(e) => t.setIsActive(e.target.checked)} disabled={t.saving} />
              <span>مورد نشط</span>
            </label>
          </div>
          <EditorActions closeForm={t.closeForm} saving={t.saving} editing={!!t.editing} />
        </form>
      )}
      <div className="ss-data-surface">
        {t.loading ? <LoadingState /> : t.filteredItems.length === 0 ? <EmptyState hasSearch={Boolean(t.query.trim())} /> : (
          <div className="ss-table-scroll">
            <table className="ss-table">
              <thead><tr><th>#</th><th>الاسم</th><th>الهاتف</th><th>البريد</th><th>العنوان</th><th>الحالة</th><th className="ss-actions-column">الإجراءات</th></tr></thead>
              <tbody>
                {t.filteredItems.map((item, index) => (
                  <tr key={item.id}>
                    <td><span className="ss-row-number">{index + 1}</span></td>
                    <td><span className="ss-item-name">{item.name}</span>{item.contactPerson ? <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{item.contactPerson}</div> : null}</td>
                    <td><span dir="ltr">{item.phoneNumber || '—'}</span></td>
                    <td><span dir="ltr">{item.email || '—'}</span></td>
                    <td><span>{item.address || '—'}</span></td>
                    <td><span dir="ltr">{item.taxNumber || '—'}</span></td>
                    <td>{item.commissionRate != null ? `${Number(item.commissionRate)}%` : '—'}</td>
                    <td>{item._count?.purchaseOrders ?? '—'}</td>
                    <td><ActiveBadge isActive={item.isActive} /></td>
                    <RowActions onEdit={() => t.startEdit(item)} onDelete={() => void t.remove(item)} saving={t.saving} name={item.name} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  )
}

export default function VendorsManagement({ navigate }: VendorsManagementProps) {
  return (
    <DashboardLayout navigate={navigate}>
      <div className="view-container">
        <VendorsView />
      </div>
    </DashboardLayout>
  )
}
