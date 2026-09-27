import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import DashboardLayout from '../../components/DashboardLayout/DashboardLayout'
import { Select } from '../../components/Select/Select'
import { inventoryApi, type StorageLocation, type Warehouse } from '../../lib/api'
import { useCurrentUser } from '../../hooks/useCurrentUser'
import { toArabicNumerals } from '../../utils/arabicNumerals'
import '../../styles/DashboardViews.css'
import '../AccountingOverview/AccountingOverview.css'

type Notice = {
  type: 'success' | 'error' | 'info'
  text: string
}

function Icon({ children, size = 18 }: { children: ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  )
}

const PlusIcon = () => <Icon><path d="M12 5v14M5 12h14" /></Icon>
const RefreshIcon = () => <Icon><path d="M20 11a8.1 8.1 0 0 0-14.8-4L3 10" /><path d="M3 5v5h5" /><path d="M4 13a8.1 8.1 0 0 0 14.8 4L21 14" /><path d="M21 19v-5h-5" /></Icon>
const EditIcon = () => <Icon size={16}><path d="m4 16-.7 4.7L8 20l10.7-10.7a2.1 2.1 0 0 0-3-3L5 17" /><path d="m14.5 7.5 2 2" /></Icon>
const TrashIcon = () => <Icon size={16}><path d="M4 7h16M10 11v5M14 11v5M6 7l1 13h10l1-13M9 7V4h6v3" /></Icon>

function StatusBanner({ notice }: { notice: Notice | null }) {
  if (!notice) return null
  return (
    <div style={{ padding: '0.5rem 1rem', fontSize: '0.8rem', background: notice.type === 'success' ? '#e6ffe6' : notice.type === 'error' ? 'var(--color-danger-soft)' : '#e6f3ff', borderBottom: '1px solid var(--border-color)' }}>
      {notice.text}
    </div>
  )
}

function getValidParentsForLocation(locations: StorageLocation[], currentLocId: string | null): StorageLocation[] {
  if (!currentLocId) return locations

  const itemMap: Record<string, StorageLocation & { childrenIds: string[] }> = {}
  locations.forEach((l) => {
    itemMap[l.id] = { ...l, childrenIds: [] }
  })

  locations.forEach((l) => {
    if (l.parentId && itemMap[l.parentId]) {
      itemMap[l.parentId].childrenIds.push(l.id)
    }
  })

  const descendants = new Set<string>()
  function collectDescendants(id: string) {
    descendants.add(id)
    const node = itemMap[id]
    if (node) {
      node.childrenIds.forEach(collectDescendants)
    }
  }
  collectDescendants(currentLocId)
  return locations.filter((l) => !descendants.has(l.id))
}

export default function StorageLocations({ navigate }: { navigate: (path: string) => void }) {
  const [allLocations, setAllLocations] = useState<StorageLocation[]>([])
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<StorageLocation | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)

  const [search, setSearch] = useState('')
  const [warehouseFilter, setWarehouseFilter] = useState('')
  const [activeFilter, setActiveFilter] = useState<boolean | undefined>(undefined)

  const [page, setPage] = useState(1)
  const pageSize = 10

  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [warehouseId, setWarehouseId] = useState('')
  const [parentId, setParentId] = useState('')
  const [maxWeightKg, setMaxWeightKg] = useState<string>('')
  const [maxVolumeM3, setMaxVolumeM3] = useState<string>('')
  const [notes, setNotes] = useState('')
  const [isActive, setIsActive] = useState(true)

  const { hasPermission } = useCurrentUser()
  const hasCreate = hasPermission('Permissions.CreateStorageLocation')
  const hasUpdate = hasPermission('Permissions.UpdateStorageLocation')
  const hasDelete = hasPermission('Permissions.DeleteStorageLocation')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [locations, whs] = await Promise.all([
        inventoryApi.listStorageLocations(),
        inventoryApi.listWarehouses().catch(() => [] as Warehouse[]),
      ])
      setAllLocations(locations)
      setWarehouses(whs)
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'تعذر تحميل مواقع التخزين.' })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const validParents = useMemo(() => {
    return getValidParentsForLocation(allLocations, editing ? editing.id : null)
  }, [allLocations, editing])

  // One list, filtered and paged here: the endpoint returns a bare array.
  const filtered = useMemo(() => allLocations.filter((item) => {
    if (warehouseFilter && item.warehouseId !== warehouseFilter) return false
    if (activeFilter !== undefined && item.isActive !== activeFilter) return false
    const q = search.trim().toLowerCase()
    if (!q) return true
    return [item.name, item.code, item.warehouse.name]
      .some((field) => (field || '').toLowerCase().includes(q))
  }), [allLocations, search, warehouseFilter, activeFilter])
  const totalEntries = filtered.length
  const totalPages = Math.max(1, Math.ceil(totalEntries / pageSize))
  const entries = filtered.slice((page - 1) * pageSize, page * pageSize)
  const nameById = useMemo(() => new Map(allLocations.map((l) => [l.id, l.name])), [allLocations])

  const startAdd = () => {
    if (!hasCreate) return
    setEditing(null)
    setName('')
    setCode('')
    setWarehouseId(warehouses[0]?.id || '')
    setParentId('')
    setMaxWeightKg('')
    setMaxVolumeM3('')
    setNotes('')
    setIsActive(true)
    setFormOpen(true)
    setNotice(null)
  }

  const startEdit = (item: StorageLocation) => {
    if (!hasUpdate) return
    setEditing(item)
    setName(item.name)
    setCode(item.code || '')
    setWarehouseId(item.warehouseId)
    setParentId(item.parentId || '')
    setMaxWeightKg(item.maxWeightKg !== undefined ? String(item.maxWeightKg) : '')
    setMaxVolumeM3(item.maxVolumeM3 !== undefined ? String(item.maxVolumeM3) : '')
    setNotes(item.notes || '')
    setIsActive(item.isActive)
    setFormOpen(true)
    setNotice(null)
  }

  const closeForm = () => {
    setFormOpen(false)
    setEditing(null)
    setName('')
    setCode('')
    setWarehouseId('')
    setParentId('')
    setMaxWeightKg('')
    setMaxVolumeM3('')
    setNotes('')
    setIsActive(true)
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const cleanName = name.trim()
    const cleanCode = code.trim()

    if (!cleanName || !cleanCode || !warehouseId) {
      setNotice({ type: 'error', text: 'يرجى إدخال الاسم، الكود، واختيار المستودع.' })
      return
    }

    setSaving(true)
    setNotice(null)
    try {
      const payload = {
        name: cleanName,
        code: cleanCode,
        parentId: parentId || null,
        maxWeightKg: maxWeightKg ? Number(maxWeightKg) : undefined,
        maxVolumeM3: maxVolumeM3 ? Number(maxVolumeM3) : undefined,
        notes: notes.trim(),
        isActive,
      }

      if (editing) {
        await inventoryApi.updateStorageLocation(editing.id, payload)
        setNotice({ type: 'success', text: 'تم تحديث موقع التخزين بنجاح.' })
      } else {
        await inventoryApi.createStorageLocation({ warehouseId, ...payload })
        setNotice({ type: 'success', text: 'تمت إضافة موقع التخزين بنجاح.' })
      }
      closeForm()
      await load()
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'تعذر حفظ البيانات.' })
    } finally {
      setSaving(false)
    }
  }

  const remove = async (item: StorageLocation) => {
    if (!hasDelete) return
    if (!window.confirm(`هل أنت متأكد من حذف موقع التخزين «${item.name}»؟`)) return
    setSaving(true)
    setNotice(null)
    try {
      await inventoryApi.deleteStorageLocation(item.id)
      setNotice({ type: 'success', text: 'تم حذف موقع التخزين بنجاح.' })
      if (editing?.id === item.id) closeForm()
      await load()
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'تعذر حذف موقع التخزين.' })
    } finally {
      setSaving(false)
    }
  }

  const disabled = loading || saving

  return (
    <DashboardLayout navigate={navigate}>
      <div className="view-container">
        <div className="view-header" style={{ marginBottom: '1.5rem' }}>
          <div>
            <h1 className="view-header-title">إدارة أماكن التخزين</h1>
            <p className="view-header-subtitle">قم بتهيئة الرفوف، الصناديق، والأماكن داخل المستودعات لتوزيع بضائعك بدقة.</p>
          </div>
        </div>

        <div className="io-data-surface">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem 1rem', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)' }}>
            <strong style={{ fontSize: '0.85rem' }}>قائمة مواقع التخزين</strong>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{toArabicNumerals(totalEntries)} موقع</span>
              <button type="button" className="io-button io-button-ghost" onClick={() => void load()} disabled={disabled} style={{ fontSize: '0.8rem', padding: '0.3rem 0.6rem' }}><RefreshIcon /> تحديث</button>
              {hasCreate && <button type="button" className="io-button io-button-primary" onClick={startAdd} disabled={disabled} style={{ fontSize: '0.8rem', padding: '0.3rem 0.6rem' }}><PlusIcon /> إضافة موقع</button>}
            </div>
          </div>

          <div className="ao-filter-bar" style={{ flexWrap: 'wrap' }}>
            <input type="text" placeholder="ابحث باسم الموقع، الكود، أو المستودع..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} />
            <div style={{ width: 160, flexShrink: 0 }}><Select value={warehouseFilter} onChange={(v) => { setWarehouseFilter(String(v)); setPage(1) }} options={[{ value: 0, label: 'كل المستودعات' }, ...warehouses.map(w => ({ value: w.id, label: w.name }))]} /></div>
            <select style={{ padding: '0.5rem 0.75rem', border: '1px solid var(--border-color)', borderRadius: 6, background: 'var(--bg-primary)', fontSize: '0.8rem', fontFamily: 'var(--font-body)', width: 110, flexShrink: 0 }} value={activeFilter === undefined ? -1 : activeFilter ? 1 : 0} onChange={(e) => { const v = Number(e.target.value); setActiveFilter(v === -1 ? undefined : v === 1); setPage(1) }}>
              <option value={-1}>الكل</option>
              <option value={1}>نشط</option>
              <option value={0}>غير نشط</option>
            </select>
          </div>

          <StatusBanner notice={notice} />

          {formOpen && (
            <form className="ss-multi-editor" onSubmit={submit} style={{ borderBottom: '1px solid var(--border-color)' }}>
              <div className="ss-multi-editor-full">
                <span className="ss-editor-kicker">{editing ? 'تعديل السجل' : 'سجل جديد'}</span>
                <h3>{editing ? 'تعديل موقع التخزين' : 'إضافة موقع تخزين'}</h3>
              </div>
              <div className="ss-editor-field">
                <label htmlFor="sl-name">الاسم</label>
                <input id="sl-name" className="ss-input" value={name} onChange={(event) => setName(event.target.value)} placeholder="مثال: الرف A-1" autoFocus disabled={saving} />
              </div>
              <div className="ss-editor-field">
                <label htmlFor="sl-code">الكود (فريد)</label>
                <input id="sl-code" className="ss-input" value={code} onChange={(event) => setCode(event.target.value)} placeholder="مثال: LOC-A1" disabled={saving} />
              </div>
              <div className="ss-editor-field">
                <label htmlFor="sl-wh">المستودع</label>
                <select id="sl-wh" className="ss-input" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} disabled={saving}>
                  {warehouses.map((wh) => (
                    <option value={wh.id} key={wh.id}>{wh.name}</option>
                  ))}
                </select>
              </div>
              <div className="ss-editor-field">
                <label htmlFor="sl-parent">الموقع الأب (اختياري)</label>
                <select id="sl-parent" className="ss-input" value={parentId} onChange={(e) => setParentId(e.target.value)} disabled={saving}>
                  <option value="">لا يوجد (مستوى رئيسي)</option>
                  {validParents.map((parent) => (
                    <option value={parent.id} key={parent.id}>{parent.name} ({parent.warehouse.name})</option>
                  ))}
                </select>
              </div>
              <div className="ss-editor-field">
                <label htmlFor="sl-weight">الوزن الأقصى (كجم) <span>اختياري</span></label>
                <input id="sl-weight" type="number" className="ss-input" value={maxWeightKg} onChange={(e) => setMaxWeightKg(e.target.value)} placeholder="الحد الأقصى للوزن" disabled={saving} />
              </div>
              <div className="ss-editor-field">
                <label htmlFor="sl-volume">الحجم الأقصى (م٣) <span>اختياري</span></label>
                <input id="sl-volume" type="number" className="ss-input" value={maxVolumeM3} onChange={(e) => setMaxVolumeM3(e.target.value)} placeholder="الحد الأقصى للحجم" disabled={saving} />
              </div>
              <div className="ss-editor-field ss-multi-editor-full">
                <label htmlFor="sl-notes">ملاحظات</label>
                <input id="sl-notes" className="ss-input" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="أي ملاحظات عن هذا الرف" disabled={saving} />
              </div>
              <div className="ss-editor-field ss-multi-editor-full">
                <label className="ss-checkbox-label">
                  <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} disabled={saving} />
                  <span>نشط (متاح للاستخدام الفوري)</span>
                </label>
              </div>
              <div className="ss-multi-editor-actions">
                <button type="button" className="ss-button ss-button-ghost" onClick={closeForm} disabled={saving}>إلغاء</button>
                <button type="submit" className="ss-button ss-button-primary" disabled={saving}>{saving ? 'جاري الحفظ...' : editing ? 'حفظ التعديل' : 'إضافة السجل'}</button>
              </div>
            </form>
          )}

          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '150px', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
              جاري التحميل...
            </div>
          ) : entries.length === 0 ? (
            <div className="io-empty-state">
              <h3>لا توجد مواقع تخزين</h3>
              <p>{search || warehouseFilter || activeFilter !== undefined ? 'لا توجد نتائج تطابق معايير البحث.' : 'لم يتم إضافة أي مواقع تخزين بعد.'}</p>
            </div>
          ) : (
            <>
              <div className="io-table-scroll ao-table-scroll">
                <table className="io-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>الكود</th>
                      <th>الاسم</th>
                      <th>المستودع</th>
                      <th>الموقع الأب</th>
                      <th>الحد الأقصى (وزن/حجم)</th>
                      <th>الحالة</th>
                      <th className="io-actions-column">الإجراءات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((item, index) => (
                      <tr key={item.id}>
                        <td><span className="io-row-number">{(page - 1) * pageSize + index + 1}</span></td>
                        <td><span style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{item.code}</span></td>
                        <td><span className="io-item-name">{item.name}</span></td>
                        <td><span>{item.warehouse.name || '—'}</span></td>
                        <td>
                          {item.parentId && nameById.get(item.parentId) ? (
                            <span className="io-related-badge">{nameById.get(item.parentId)}</span>
                          ) : (
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>رئيسي</span>
                          )}
                        </td>
                        <td>
                          <span>
                            {item.maxWeightKg !== undefined ? `${item.maxWeightKg} كجم` : '—'}
                            {' / '}
                            {item.maxVolumeM3 !== undefined ? `${item.maxVolumeM3} م³` : '—'}
                          </span>
                        </td>
                        <td>
                          <span style={{ background: 'var(--bg-secondary)', padding: '2px 6px', borderRadius: '4px', fontSize: '0.85rem' }}>
                            {item.isActive ? 'نشط' : 'غير نشط'}
                          </span>
                        </td>
                        <td className="io-actions-column">
                          <div className="io-row-actions">
                            {hasUpdate && <button className="io-icon-button" style={{ color: 'var(--text-secondary)' }} onClick={() => startEdit(item)} disabled={saving} aria-label={`تعديل ${item.name}`} title="تعديل"><EditIcon /></button>}
                            {hasDelete && <button className="io-icon-button io-icon-delete" onClick={() => void remove(item)} disabled={saving} aria-label={`حذف ${item.name}`} title="حذف"><TrashIcon /></button>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {totalPages > 1 && (
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem', padding: '0.75rem 1rem', borderTop: '1px solid var(--border-color)' }}>
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    style={{ padding: '0.4rem 0.8rem', border: '1px solid var(--border-color)', borderRadius: 6, background: 'var(--bg-primary)', cursor: page <= 1 ? 'default' : 'pointer', opacity: page <= 1 ? 0.4 : 1, fontSize: '0.8rem' }}
                  >
                    السابق
                  </button>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    الصفحة {toArabicNumerals(page)} من {toArabicNumerals(totalPages)}
                  </span>
                  <button
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                    style={{ padding: '0.4rem 0.8rem', border: '1px solid var(--border-color)', borderRadius: 6, background: 'var(--bg-primary)', cursor: page >= totalPages ? 'default' : 'pointer', opacity: page >= totalPages ? 0.4 : 1, fontSize: '0.8rem' }}
                  >
                    التالي
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </DashboardLayout>
  )
}
