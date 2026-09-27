import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import DashboardLayout from '../../components/DashboardLayout/DashboardLayout'
import { toArabicNumerals } from '../../utils/arabicNumerals'
import RemoteImage from '../../components/RemoteImage/RemoteImage'
import { catalogApi, type Category } from '../../lib/api'
import { useCurrentUser } from '../../hooks/useCurrentUser'
import { useFilePicker } from '../../lib/useImageUpload'
import '../SystemSettings/SystemSettings.css'

interface CategoriesManagementProps {
  navigate: (path: string) => void
  embedded?: boolean
}

type Notice = {
  type: 'success' | 'error' | 'info'
  text: string
}

function Icon({ children, size = 18 }: { children: ReactNode; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
}

const PlusIcon = () => <Icon><path d="M12 5v14M5 12h14" /></Icon>
const RefreshIcon = () => <Icon><path d="M20 11a8.1 8.1 0 0 0-14.8-4L3 10" /><path d="M3 5v5h5" /><path d="M4 13a8.1 8.1 0 0 0 14.8 4L21 14" /><path d="M21 19v-5h-5" /></Icon>
const SearchIcon = () => <Icon size={16}><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></Icon>
const EditIcon = () => <Icon size={16}><path d="m4 16-.7 4.7L8 20l10.7-10.7a2.1 2.1 0 0 0-3-3L5 17" /><path d="m14.5 7.5 2 2" /></Icon>
const TrashIcon = () => <Icon size={16}><path d="M4 7h16M10 11v5M14 11v5M6 7l1 13h10l1-13M9 7V4h6v3" /></Icon>
const CheckIcon = () => <Icon size={16}><path d="m5 12 4 4L19 6" /></Icon>
const AlertIcon = () => <Icon size={16}><path d="M12 9v4M12 17h.01" /><path d="M10.3 4.4 2.6 18a1.4 1.4 0 0 0 1.2 2h16.4a1.4 1.4 0 0 0 1.2-2L13.7 4.4a2 2 0 0 0-3.4 0Z" /></Icon>
const InfoIcon = () => <Icon size={16}><circle cx="12" cy="12" r="9" /><path d="M12 10v6M12 7h.01" /></Icon>
const LayersIcon = () => <Icon><polygon points="12 2 2 7 12 12 22 7 12 2" /><polygon points="2 17 12 22 22 17" /><polygon points="2 12 12 17 22 12" /></Icon>

function StatusBanner({ notice }: { notice: Notice | null }) {
  if (!notice) return null
  return <div className={`ss-status ss-status-${notice.type}`} role={notice.type === 'error' ? 'alert' : 'status'}><span className="ss-status-icon">{notice.type === 'success' ? <CheckIcon /> : notice.type === 'error' ? <AlertIcon /> : <InfoIcon />}</span><span>{notice.text}</span></div>
}

function Button({ children, variant = 'primary', type = 'button', onClick, disabled = false, className = '' }: {
  children: ReactNode; variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; type?: 'button' | 'submit'; onClick?: () => void; disabled?: boolean; className?: string
}) {
  return <button type={type} className={`ss-button ss-button-${variant} ${className}`} onClick={onClick} disabled={disabled}>{children}</button>
}

function EmptyState({ singular, onAdd, hasSearch }: { singular: string; onAdd: () => void; hasSearch: boolean }) {
  return (
    <div className="ss-empty-state">
      <div className="ss-empty-mark"><span>+</span></div>
      <h3>{hasSearch ? 'لا توجد نتائج مطابقة' : `لا توجد ${singular} مضافة بعد`}</h3>
      <p>{hasSearch ? 'جرّب تغيير كلمات البحث أو امسح الفلتر الحالي.' : `ابدأ بإضافة أول ${singular} ليظهر هنا.`}</p>
      {!hasSearch && <Button variant="secondary" onClick={onAdd}><PlusIcon /> إضافة {singular}</Button>}
    </div>
  )
}

function LoadingState() {
  return <div className="ss-loading-list" aria-label="جاري التحميل">{[1, 2, 3, 4].map((item) => <div className="ss-skeleton-row" key={item}><span /><span /><span /></div>)}</div>
}

interface CategoryNode extends Category { children: CategoryNode[]; level: number }

function buildCategoryTree(categories: Category[]): CategoryNode[] {
  const itemMap: Record<string, CategoryNode> = {}
  const roots: CategoryNode[] = []
  categories.forEach((cat) => { itemMap[cat.id] = { ...cat, children: [], level: 0 } })
  categories.forEach((cat) => {
    const node = itemMap[cat.id]
    if (cat.parentId && itemMap[cat.parentId]) {
      const parent = itemMap[cat.parentId]; let temp: CategoryNode | undefined = parent; let cycle = false
      while (temp) { if (temp.id === node.id) { cycle = true; break }; temp = temp.parentId ? itemMap[temp.parentId] : undefined }
      if (!cycle) parent.children.push(node); else roots.push(node)
    } else { roots.push(node) }
  })
  function setLevels(nodes: CategoryNode[], level: number) { nodes.forEach((node) => { node.level = level; if (node.children.length > 0) setLevels(node.children, level + 1) }) }
  setLevels(roots, 0)
  return roots
}

function flattenCategoryTree(roots: CategoryNode[]): CategoryNode[] {
  const result: CategoryNode[] = []
  function recurse(nodes: CategoryNode[]) { nodes.forEach((node) => { result.push(node); if (node.children.length > 0) recurse(node.children) }) }
  recurse(roots)
  return result
}

function getValidParentsForCategory(categories: Category[], currentCategoryId: string | null): Category[] {
  if (!currentCategoryId) return categories
  const itemMap: Record<string, Category & { childrenIds: string[] }> = {}
  categories.forEach((c) => { itemMap[c.id] = { ...c, childrenIds: [] } })
  categories.forEach((c) => { if (c.parentId && itemMap[c.parentId]) itemMap[c.parentId].childrenIds.push(c.id) })
  const descendants = new Set<string>()
  function collectDescendants(id: string) { descendants.add(id); const node = itemMap[id]; if (node) node.childrenIds.forEach(collectDescendants) }
  collectDescendants(currentCategoryId)
  return categories.filter((c) => !descendants.has(c.id))
}

function CategoriesTab() {
  const [items, setItems] = useState<Category[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Category | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [parentCategoryId, setParentCategoryId] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [sortOrder, setSortOrder] = useState('')
  const [imageUrl, setImageUrl] = useState('')

  // Store the selected image in R2 and keep the returned asset address for save.
  const imagePicker = useFilePicker((url) => {
    if (url) setImageUrl(url)
  })
  const [notice, setNotice] = useState<Notice | null>(null)
  const [lastLoaded, setLastLoaded] = useState<Date | null>(null)

  // Permissions come from the server's answer about who we are, not from role
  // names copied into localStorage at login.
  const { hasPermission } = useCurrentUser()
  const hasCreate = hasPermission('Permissions.CreateCategory')
  const hasUpdate = hasPermission('Permissions.UpdateCategory')
  const hasDelete = hasPermission('Permissions.DeleteCategory')

  const load = useCallback(async (showLoader = true) => {
    if (showLoader) setLoading(true)
    try {
      const page = await catalogApi.listCategories({ pageSize: 200 })
      setItems(page.items)
      setLastLoaded(new Date())
    } catch (error) { setNotice({ type: 'error', text: error instanceof Error ? error.message : 'تعذر تحميل الأقسام.' }) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load])

  const treeNodes = useMemo(() => buildCategoryTree(items), [items])
  const flattenedList = useMemo(() => flattenCategoryTree(treeNodes), [treeNodes])
  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return flattenedList
    return flattenedList.filter((item) => item.name.toLowerCase().includes(q) || (item.description && item.description.toLowerCase().includes(q)))
  }, [flattenedList, query])
  const validParents = useMemo(() => getValidParentsForCategory(items, editing ? editing.id : null), [items, editing])
  const nameById = useMemo(() => new Map(items.map((c) => [c.id, c.name])), [items])

  const startAdd = () => {
    if (!hasCreate) return; setEditing(null); setName(''); setDescription(''); setParentCategoryId(''); setIsActive(true); setImageUrl(''); setSortOrder(''); setFormOpen(true); setNotice(null)
  }
  const startEdit = (item: Category) => {
    if (!hasUpdate) return; setEditing(item); setName(item.name); setDescription(item.description || ''); setParentCategoryId(item.parentId || ''); setIsActive(item.isActive); setImageUrl(item.imageUrl || ''); setSortOrder(String(item.sortOrder)); setFormOpen(true); setNotice(null)
  }
  const closeForm = () => { setFormOpen(false); setEditing(null); setName(''); setDescription(''); setParentCategoryId(''); setIsActive(true); setImageUrl(''); setSortOrder('') }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const cleanName = name.trim()
    if (!cleanName) { setNotice({ type: 'error', text: 'يرجى إدخال اسم القسم.' }); return }
    setSaving(true); setNotice(null)
    try {
      const payload = { name: cleanName, description: description.trim() || null, imageUrl: imageUrl.trim() || null, isActive, parentId: parentCategoryId || null, sortOrder: sortOrder.trim() === '' ? 0 : Math.max(0, Number(sortOrder) || 0) }
      if (editing) {
        await catalogApi.updateCategory(editing.id, payload)
        setNotice({ type: 'success', text: 'تم تحديث القسم بنجاح.' })
      } else {
        await catalogApi.createCategory(payload)
        setNotice({ type: 'success', text: 'تمت إضافة القسم بنجاح.' })
      }
      closeForm(); await load(false)
    } catch (error) { setNotice({ type: 'error', text: error instanceof Error ? error.message : 'تعذر حفظ البيانات.' }) }
    finally { setSaving(false) }
  }

  const remove = async (item: Category) => {
    if (!hasDelete) return
    if (!window.confirm(`هل أنت متأكد من حذف القسم «${item.name}» وكل ما يتعلق به؟`)) return
    setSaving(true); setNotice(null)
    try {
      await catalogApi.deleteCategory(item.id)
      setNotice({ type: 'success', text: 'تم حذف القسم بنجاح.' })
      if (editing?.id === item.id) closeForm()
      await load(false)
    } catch (error) { setNotice({ type: 'error', text: error instanceof Error ? error.message : 'تعذر حذف القسم.' }) }
    finally { setSaving(false) }
  }

  return (
    <section className="ss-module animate-fade-in">
      <div className="ss-module-heading">
        <div className="ss-module-icon"><LayersIcon /></div>
        <div>
          <p className="ss-eyebrow">بيانات مرجعية</p>
          <h2>شجرة الأقسام (Categories)</h2>
          <p>إدارة الأقسام وتصنيفاتها الشجرية للمنتجات بشكل هرمي متداخل.</p>
        </div>
      </div>
      <div className="ss-module-actions">
        <span className="ss-count-chip"><strong>{items.length}</strong> أقسام</span>
        <Button variant="ghost" onClick={() => void load()} disabled={loading || saving}><RefreshIcon /> تحديث</Button>
        {hasCreate && <Button onClick={startAdd} disabled={saving}><PlusIcon /> إضافة قسم</Button>}
      </div>
      <StatusBanner notice={notice} />
      <div className="ss-list-toolbar">
        <label className="ss-search"><SearchIcon /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ابحث باسم القسم أو الوصف..." aria-label="البحث في الأقسام" /></label>
        <span className="ss-last-loaded">{lastLoaded ? `آخر تحديث ${lastLoaded.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}` : 'جاري تجهيز القائمة'}</span>
      </div>
      {formOpen && (
        <form className="ss-multi-editor" onSubmit={submit}>
          <div className="ss-multi-editor-full"><span className="ss-editor-kicker">{editing ? 'تعديل السجل' : 'سجل جديد'}</span><h3>{editing ? 'تعديل القسم' : 'إضافة قسم'}</h3></div>
          <div className="ss-editor-field"><label htmlFor="cat-name">اسم القسم</label><input id="cat-name" className="ss-input" value={name} onChange={(event) => setName(event.target.value)} placeholder="مثال: ملابس، أجهزة منزلية" autoFocus disabled={saving} /></div>
          <div className="ss-editor-field"><label htmlFor="cat-parent">القسم الرئيسي (أعلى شجرة)</label><select id="cat-parent" className="ss-input" value={parentCategoryId} onChange={(e) => setParentCategoryId(e.target.value)} disabled={saving}><option value="">لا يوجد (قسم رئيسي)</option>{validParents.map((parent) => <option value={parent.id} key={parent.id}>{parent.name}</option>)}</select></div>
          <div className="ss-editor-field ss-multi-editor-full"><label htmlFor="cat-desc">الوصف</label><input id="cat-desc" className="ss-input" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="وصف قصير للقسم" disabled={saving} /></div>
          <div className="ss-editor-field ss-multi-editor-full">
            <label htmlFor="cat-image">صورة القسم</label>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem' }}>
              <input id="cat-image" ref={imagePicker.inputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" style={{ display: 'none' }} onChange={(e) => void imagePicker.onChange(e)} />
              <button type="button" className="io-button" onClick={imagePicker.openPicker} disabled={imagePicker.uploading || saving}>{imagePicker.uploading ? 'جاري الرفع...' : 'اختيار صورة'}</button>
              {imageUrl.trim() && <RemoteImage path={imageUrl.trim()} alt="Category Image" className="ss-file-preview" />}
              {imageUrl.trim() && <button type="button" className="io-button io-button-ghost" onClick={() => setImageUrl('')} disabled={saving}>إزالة الصورة</button>}
            </div>
          </div>
          <div className="ss-editor-field"><label htmlFor="cat-sort">الترتيب</label><input id="cat-sort" className="ss-input" type="number" min="0" max="9999" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} placeholder="0" disabled={saving} style={{ direction: 'ltr' }} /></div>
          <div className="ss-editor-field ss-multi-editor-full"><label className="ss-checkbox-label"><input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} disabled={saving} /><span>نشط (متاح للاستخدام في تصنيف المنتجات)</span></label></div>
          <div className="ss-multi-editor-actions"><Button variant="ghost" onClick={closeForm} disabled={saving}>إلغاء</Button><Button type="submit" disabled={saving}>{saving ? 'جاري الحفظ...' : editing ? 'حفظ التعديل' : 'إضافة السجل'}</Button></div>
        </form>
      )}
      <div className="ss-data-surface">
        {loading ? <LoadingState /> : filteredItems.length === 0 ? <EmptyState singular="قسم" onAdd={startAdd} hasSearch={Boolean(query.trim())} /> : (
          <div className="ss-table-scroll"><table className="ss-table"><thead><tr><th>#</th><th>الصورة</th><th>الاسم</th><th>القسم الرئيسي</th><th>الوصف</th><th>الرابط (Slug)</th><th>الترتيب</th><th>المنتجات</th><th>الفروع</th><th>الحالة</th><th className="ss-actions-column">الإجراءات</th></tr></thead><tbody>
            {filteredItems.map((item, index) => {
              const isSearchActive = Boolean(query.trim())
              const displayName = isSearchActive ? item.name : `${'\u00A0'.repeat(item.level * 4)}${item.level > 0 ? '└── ' : ''}${item.name}`
              return (
                <tr key={item.id}>
                  <td><span className="ss-row-number">{index + 1}</span></td>
                  <td><span className="ss-item-name" style={{ whiteSpace: 'pre' }}>{displayName}</span></td>
                  <td>{item.parentId && nameById.get(item.parentId) ? <span className="ss-related-badge">{nameById.get(item.parentId)}</span> : <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>قسم رئيسي</span>}</td>
                  <td><span>{item.description || '—'}</span></td>
                  <td><span dir="ltr">{item.slug || '—'}</span></td>
                  <td>{toArabicNumerals(String(item.sortOrder))}</td>
                  <td>{toArabicNumerals(String(item._count?.products ?? 0))}</td>
                  <td>{toArabicNumerals(String(item._count?.children ?? 0))}</td>
                  <td><span className="ss-related-badge" style={!item.isActive ? { background: 'var(--border-color)', color: 'var(--text-muted)' } : undefined}>{item.isActive ? 'نشط' : 'غير نشط'}</span></td>
                  <td className="ss-actions-column"><div className="ss-row-actions">{hasUpdate && <button className="ss-icon-button ss-icon-edit" onClick={() => startEdit(item)} disabled={saving} aria-label={`تعديل ${item.name}`} title="تعديل"><EditIcon /></button>}{hasDelete && <button className="ss-icon-button ss-icon-delete" onClick={() => void remove(item)} disabled={saving} aria-label={`حذف ${item.name}`} title="حذف"><TrashIcon /></button>}</div></td>
                </tr>
              )
            })}
          </tbody></table></div>
        )}
      </div>
    </section>
  )
}

export default function CategoriesManagement({ navigate, embedded = false }: CategoriesManagementProps) {
  const content = (
    <div className="view-container">
      <CategoriesTab />
    </div>
  )

  if (embedded) {
    return content
  }

  return (
    <DashboardLayout navigate={navigate}>
      {content}
    </DashboardLayout>
  )
}
