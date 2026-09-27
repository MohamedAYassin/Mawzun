import { useCallback, useEffect, useState } from 'react'
import DashboardLayout from '../../components/DashboardLayout/DashboardLayout'
import { catalogApi, type Uom } from '../../lib/api'
import { Button, EmptyState, LoadingState, ListToolbar, ModuleHeading, StatusBanner, BoxIcon, PlusIcon, RowActions, type Notice } from '../shared/ManagementUi'
import '../SystemSettings/SystemSettings.css'

interface UomManagementProps {
  navigate: (path: string) => void
}

const emptyForm = { name: '', code: '', category: 'general', isActive: true }

export default function UomManagement({ navigate }: UomManagementProps) {
  const [items, setItems] = useState<Uom[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Uom | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async (showLoader = true) => {
    if (showLoader) setLoading(true)
    try {
      const result = await catalogApi.listUoms({ search: query || undefined })
      setItems(result)
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'تعذر تحميل وحدات القياس.' })
    } finally { setLoading(false) }
  }, [query])

  useEffect(() => { void load() }, [load])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setNotice(null)
    try {
      if (editing) await catalogApi.updateUom(editing.id, form)
      else await catalogApi.createUom(form)
      setFormOpen(false); setEditing(null); setForm(emptyForm)
      await load(false)
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'تعذر الحفظ.' })
    } finally { setSaving(false) }
  }

  const remove = async (item: Uom) => {
    if (!window.confirm('تأكيد حذف ' + item.name + '؟')) return
    try {
      await catalogApi.deleteUom(item.id)
      await load(false)
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'تعذر الحذف.' })
    }
  }

  return (
    <DashboardLayout navigate={navigate}>
      <div className="view-container">
        <section className="ss-module animate-fade-in">
          <ModuleHeading icon={<BoxIcon />} eyebrow="المنتجات" title="فئات وحدات القياس" subtitle="إدارة وحدات القياس المستخدمة في المنتجات والمشتريات." />
          <div className="ss-module-actions">
            <span className="ss-count-chip"><strong>{items.length}</strong> وحدة</span>
            <Button variant="primary" onClick={() => { setFormOpen(true); setEditing(null); setForm(emptyForm) }}><PlusIcon /> وحدة جديدة</Button>
            <Button variant="ghost" onClick={() => void load()} disabled={loading}>تحديث</Button>
          </div>
          <StatusBanner notice={notice} />
          {formOpen && (
            <form onSubmit={submit} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem', padding: '1rem', border: '1px solid var(--border-color)', borderRadius: '10px', marginBottom: '1rem' }}>
              <input className="ss-input" placeholder="الاسم" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
              <input className="ss-input" placeholder="الرمز" value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} required />
              <input className="ss-input" placeholder="الفئة" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} />
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <input type="checkbox" checked={form.isActive} onChange={e => setForm(f => ({ ...f, isActive: e.target.checked }))} /> نشطة
              </label>
              <Button variant="primary" type="submit" disabled={saving}>{saving ? 'جاري الحفظ...' : 'حفظ'}</Button>
            </form>
          )}
          <div className="ss-list-toolbar">
            <ListToolbar query={query} setQuery={setQuery} placeholder="ابحث باسم أو رمز الوحدة..." lastLoaded={null} />
          </div>
          <div className="ss-data-surface">
            {loading ? <LoadingState /> : items.length === 0 ? <EmptyState hasSearch={Boolean(query.trim())} /> : (
              <div className="ss-table-scroll">
                <table className="ss-table">
                  <thead><tr><th>#</th><th>الاسم</th><th>الرمز</th><th>الفئة</th><th>الحالة</th><th>إجراءات</th></tr></thead>
                  <tbody>
                    {items.map((item, index) => (
                      <tr key={item.id}>
                        <td>{index + 1}</td>
                        <td>{item.name}</td>
                        <td>{item.code}</td>
                        <td>{item.category}</td>
                        <td>{item.isActive ? 'نشطة' : 'موقوفة'}</td>
                        <td>
                          <RowActions
                            onEdit={() => { setFormOpen(true); setEditing(item); setForm({ name: item.name, code: item.code, category: item.category, isActive: item.isActive }) }}
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
