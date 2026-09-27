import { useEffect, useState } from 'react'
import DashboardLayout from '../../components/DashboardLayout/DashboardLayout'
import { catalogApi, type ProductAttribute, type AttributeValue, type ProductMerge, type ProductListItem, type ProductVariant, type AttributeType } from '../../lib/api'
import { ActiveBadge, BoxIcon, EmptyState, EditorActions, EditorHeader, ListToolbar, LoadingState, ModuleActions, ModuleHeading, Notice, RowActions, StatusBanner, TagIcon } from '../shared/ManagementUi'

type ProductFamilyTab = 'attributes' | 'attribute-values' | 'variants' | 'merges'

function printVariantBarcode(variant: ProductVariant) {
  // Without this guard, `variant.barcode || variant.skuCode` interpolates the
  // literal text "undefined" into the JsBarcode call — encoding a bogus barcode
  // and throwing, which killed the print handler on the following line.
  const code = (variant.barcode || variant.skuCode || '').trim()
  if (!code) {
    alert('لا يمكن طباعة الباركود: هذا المتغير بلا باركود أو كود صنف.')
    return
  }
  const printWindow = window.open('', '_blank', 'width=700,height=800')
  if (!printWindow) {
    alert('يرجى السماح بالنوافذ المنبثقة لطباعة الباركود.')
    return
  }
  const price = Number(variant.price || 0).toFixed(2)
  printWindow.document.write(`<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><title>طباعة باركود - ${variant.name}</title><style>@page{margin:0}html,body{margin:0;padding:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#fff;font-family:system-ui,'Segoe UI',sans-serif}.t{font-size:1.4rem;font-weight:700;margin:0 0 10px;color:#000}.sku{font-size:.95rem;color:#000;background:#e6e6e6;padding:.25rem .6rem;border-radius:4px;font-family:monospace;margin-bottom:12px}.p{font-size:1.6rem;font-weight:800;margin-bottom:14px}</style></head><body>
    <div class="t">${variant.name}</div>
    <div class="sku">${variant.skuCode}</div>
    <div class="p">${price} ج.م</div>
    <svg id="barcode"></svg>
    <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js"></script>
    <script>JsBarcode("#barcode","${code}",{format:"CODE128",width:2,height:70,displayValue:true,fontSize:16,fontOptions:"bold",textMargin:4});window.onload=function(){setTimeout(function(){window.print();window.close()},350)}</script>
  </body></html>`)
  printWindow.document.close()
}

function AttributesTab() {
  const [items, setItems] = useState<ProductAttribute[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [lastLoaded, setLastLoaded] = useState<Date | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<ProductAttribute | null>(null)
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [type, setType] = useState<AttributeType>('SELECT')
  const [isActive, setIsActive] = useState(true)

  const load = async () => {
    setLoading(true)
    try {
      const result = await catalogApi.listAttributes()
      setItems(result)
      setLastLoaded(new Date())
      setNotice(null)
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'تعذر تحميل خصائص المنتجات.' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const filteredItems = items.filter(item => [item.name, item.code].some(value => value.toLowerCase().includes(query.trim().toLowerCase())))
  const closeForm = () => {
    setFormOpen(false)
    setEditing(null)
    setName('')
    setCode('')
    setType('SELECT')
    setIsActive(true)
  }

  const startEdit = (item: ProductAttribute) => {
    setEditing(item)
    setName(item.name)
    setCode(item.code)
    setType(item.type)
    setIsActive(item.isActive)
    setFormOpen(true)
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    try {
      const dto = { name, code, type, isActive }
      if (editing) await catalogApi.updateAttribute(editing.id, dto)
      else await catalogApi.createAttribute(dto)
      setNotice({ type: 'success', text: editing ? 'تم تحديث الخاصية.' : 'تم إضافة الخاصية.' })
      closeForm()
      await load()
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'تعذر حفظ الخاصية.' })
    } finally {
      setSaving(false)
    }
  }

  const remove = async (item: ProductAttribute) => {
    setSaving(true)
    try {
      await catalogApi.deleteAttribute(item.id)
      setNotice({ type: 'success', text: 'تم حذف الخاصية.' })
      await load()
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'تعذر حذف الخاصية.' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <ModuleActions count={items.length} countLabel="خاصية" onRefresh={() => void load()} loading={loading} saving={saving} onAdd={() => setFormOpen(true)} addLabel="إضافة خاصية" />
      <StatusBanner notice={notice} />
      <ListToolbar query={query} setQuery={setQuery} placeholder="ابحث بالاسم أو الرمز..." lastLoaded={lastLoaded} />
      {formOpen && (
        <form className="ss-multi-editor" onSubmit={submit}>
          <EditorHeader editing={!!editing} singular="الخاصية" />
          <div className="ss-editor-field"><label htmlFor="attribute-name">اسم الخاصية</label><input id="attribute-name" className="ss-input" value={name} onChange={event => setName(event.target.value)} required /></div>
          <div className="ss-editor-field"><label htmlFor="attribute-code">الرمز</label><input id="attribute-code" className="ss-input" value={code} onChange={event => setCode(event.target.value)} required /></div>
          <div className="ss-editor-field"><label htmlFor="attribute-type">النوع</label><select id="attribute-type" className="ss-input" value={type} onChange={event => setType(event.target.value as AttributeType)}><option value="TEXT">نص</option><option value="SELECT">قائمة</option><option value="COLOR">لون</option></select></div>
          <div className="ss-editor-field ss-multi-editor-full"><label className="ss-checkbox-label"><input type="checkbox" checked={isActive} onChange={event => setIsActive(event.target.checked)} /><span>نشط</span></label></div>
          <EditorActions closeForm={closeForm} saving={saving} editing={!!editing} />
        </form>
      )}
      <div className="ss-data-surface">
        {loading ? <LoadingState /> : filteredItems.length === 0 ? <EmptyState hasSearch={Boolean(query.trim())} /> : (
          <div className="ss-table-scroll"><table className="ss-table">
            <thead><tr><th>#</th><th>الاسم</th><th>الرمز</th><th>النوع</th><th>القيم</th><th>الحالة</th><th className="ss-actions-column">الإجراءات</th></tr></thead>
            <tbody>{filteredItems.map((item, index) => (
              <tr key={item.id}><td><span className="ss-row-number">{index + 1}</span></td><td><span className="ss-item-name">{item.name}</span></td><td>{item.code}</td><td>{item.type === 'SELECT' ? 'قائمة' : item.type === 'COLOR' ? 'لون' : 'نص'}</td><td>{item._count.values}</td><td><ActiveBadge isActive={item.isActive} /></td><RowActions onEdit={() => startEdit(item)} onDelete={() => void remove(item)} saving={saving} name={item.name} /></tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
    </div>
  )
}

type ValueRow = AttributeValue & { attributeId: string; attributeName: string }

function AttributeValuesTab() {
  const [items, setItems] = useState<ValueRow[]>([])
  const [attributes, setAttributes] = useState<ProductAttribute[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [lastLoaded, setLastLoaded] = useState<Date | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<ValueRow | null>(null)
  const [attributeId, setAttributeId] = useState('')
  const [value, setValue] = useState('')
  const [skuSuffix, setSkuSuffix] = useState('')
  const [barcode, setBarcode] = useState('')
  const [sortOrder, setSortOrder] = useState(0)
  const [isActive, setIsActive] = useState(true)

  const load = async () => {
    setLoading(true)
    try {
      const [attributesResult] = await Promise.all([catalogApi.listAttributes()])
      setAttributes(attributesResult)
      // Values are nested per attribute; flatten for the table.
      const valueLists = await Promise.all(attributesResult.map((attribute) =>
        catalogApi.listAttributeValues(attribute.id).then((values) => values.map((value) => ({ ...value, attributeId: attribute.id, attributeName: attribute.name })))
      ))
      setItems(valueLists.flat())
      setLastLoaded(new Date())
      setNotice(null)
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'تعذر تحميل قيم الخصائص.' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const filteredItems = items.filter(item => [item.value, item.attributeName].some(field => field.toLowerCase().includes(query.trim().toLowerCase())))
  const closeForm = () => {
    setFormOpen(false)
    setEditing(null)
    setAttributeId('')
    setValue('')
    setSkuSuffix('')
    setBarcode('')
    setSortOrder(0)
    setIsActive(true)
  }

  const startEdit = (item: ValueRow) => {
    setEditing(item)
    setAttributeId(String(item.attributeId))
    setValue(item.value)
    setSkuSuffix(item.skuSuffix || '')
    setBarcode(item.barcode || '')
    setSortOrder(item.sortOrder)
    setIsActive(item.isActive)
    setFormOpen(true)
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!attributeId) {
      setNotice({ type: 'error', text: 'يجب اختيار الخاصية.' })
      return
    }
    setSaving(true)
    try {
      const dto = { value, skuSuffix: skuSuffix || null, barcode: barcode || null, sortOrder, isActive }
      if (editing) await catalogApi.updateAttributeValue(attributeId, editing.id, dto)
      else await catalogApi.createAttributeValue(attributeId, dto)
      setNotice({ type: 'success', text: editing ? 'تم تحديث القيمة.' : 'تم إضافة القيمة.' })
      closeForm()
      await load()
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'تعذر حفظ القيمة.' })
    } finally {
      setSaving(false)
    }
  }

  const remove = async (item: ValueRow) => {
    setSaving(true)
    try {
      await catalogApi.deleteAttributeValue(item.attributeId, item.id)
      setNotice({ type: 'success', text: 'تم حذف القيمة.' })
      await load()
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'تعذر حذف القيمة.' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <ModuleActions count={items.length} countLabel="قيمة" onRefresh={() => void load()} loading={loading} saving={saving} onAdd={() => setFormOpen(true)} addLabel="إضافة قيمة" />
      <StatusBanner notice={notice} />
      <ListToolbar query={query} setQuery={setQuery} placeholder="ابحث بالقيمة أو الخاصية..." lastLoaded={lastLoaded} />
      {formOpen && (
        <form className="ss-multi-editor" onSubmit={submit}>
          <EditorHeader editing={!!editing} singular="قيمة الخاصية" />
          <div className="ss-editor-field"><label htmlFor="value-attribute">الخاصية</label><select id="value-attribute" className="ss-input" value={attributeId} onChange={event => setAttributeId(event.target.value)} required><option value="">اختر الخاصية</option>{attributes.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
          <div className="ss-editor-field"><label htmlFor="value-value">القيمة</label><input id="value-value" className="ss-input" value={value} onChange={event => setValue(event.target.value)} required /></div>
          <div className="ss-editor-field"><label htmlFor="value-sku">لاحقة SKU</label><input id="value-sku" className="ss-input" value={skuSuffix} onChange={event => setSkuSuffix(event.target.value)} /></div>
          <div className="ss-editor-field"><label htmlFor="value-barcode">الباركود</label><input id="value-barcode" className="ss-input" value={barcode} onChange={event => setBarcode(event.target.value)} /></div>
          <div className="ss-editor-field"><label htmlFor="value-sort">ترتيب العرض</label><input id="value-sort" className="ss-input" type="number" min={0} value={sortOrder} onChange={event => setSortOrder(Number(event.target.value))} /></div>
          <div className="ss-editor-field ss-multi-editor-full"><label className="ss-checkbox-label"><input type="checkbox" checked={isActive} onChange={event => setIsActive(event.target.checked)} /><span>نشط</span></label></div>
          <EditorActions closeForm={closeForm} saving={saving} editing={!!editing} />
        </form>
      )}
      <div className="ss-data-surface">
        {loading ? <LoadingState /> : filteredItems.length === 0 ? <EmptyState hasSearch={Boolean(query.trim())} /> : (
          <div className="ss-table-scroll"><table className="ss-table">
            <thead><tr><th>#</th><th>الخاصية</th><th>القيمة</th><th>لاحقة SKU</th><th>الباركود</th><th>الحالة</th><th className="ss-actions-column">الإجراءات</th></tr></thead>
            <tbody>{filteredItems.map((item, index) => (
              <tr key={item.id}><td><span className="ss-row-number">{index + 1}</span></td><td>{item.attributeName}</td><td><span className="ss-item-name">{item.value}</span></td><td>{item.skuSuffix || '—'}</td><td>{item.barcode || '—'}</td><td><ActiveBadge isActive={item.isActive} /></td><RowActions onEdit={() => startEdit(item)} onDelete={() => void remove(item)} saving={saving} name={item.value} /></tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
    </div>
  )
}

function VariantsTab() {
  // Variants have no standalone endpoints: they live on their product, and
  // the product update replaces them wholesale. This tab is read-only.
  const [items, setItems] = useState<{ variant: ProductVariant; product: ProductListItem }[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [lastLoaded, setLastLoaded] = useState<Date | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const productPage = await catalogApi.listProducts({ pageSize: 100 })
      const detailLists = await Promise.all(productPage.items.map((product) =>
        catalogApi.getProduct(product.id).then((full) => full.variants.map((variant) => ({ variant, product })))
      ))
      setItems(detailLists.flat())
      setLastLoaded(new Date())
      setNotice(null)
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'تعذر تحميل متغيرات المنتجات.' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  const filteredItems = items.filter(item => [item.variant.name, item.variant.skuCode, item.variant.barcode].some(field => (field || '').toLowerCase().includes(query.trim().toLowerCase())))

  return (
    <div>
      <ModuleActions count={items.length} countLabel="متغير" onRefresh={() => void load()} loading={loading} saving={false} onAdd={() => setNotice({ type: 'info', text: 'تُدار المتغيرات من صفحة تعديل المنتج نفسها.' })} addLabel="إضافة متغير" />
      <StatusBanner notice={notice} />
      <ListToolbar query={query} setQuery={setQuery} placeholder="ابحث بالاسم أو SKU أو الباركود..." lastLoaded={lastLoaded} />
      <div className="ss-data-surface">
        {loading ? <LoadingState /> : filteredItems.length === 0 ? <EmptyState hasSearch={Boolean(query.trim())} /> : (
          <div className="ss-table-scroll"><table className="ss-table">
            <thead><tr><th>#</th><th>المتغير</th><th>المنتج</th><th>SKU</th><th>السعر</th><th>التكلفة</th><th>الحالة</th><th className="ss-actions-column">الباركود</th></tr></thead>
            <tbody>{filteredItems.map((item, index) => (
              <tr key={item.variant.id}><td><span className="ss-row-number">{index + 1}</span></td><td><span className="ss-item-name">{item.variant.name}</span></td><td>{item.product.name}</td><td>{item.variant.skuCode}</td><td>{item.variant.price}</td><td>{item.variant.costPrice}</td><td><ActiveBadge isActive={item.variant.isActive} /></td><td><button className="ss-icon-button ss-icon-edit" onClick={() => printVariantBarcode(item.variant)} title="طباعة الباركود" aria-label={`طباعة باركود ${item.variant.name}`}>&#x2319;</button></td></tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
    </div>
  )
}

function MergesTab() {
  const [items, setItems] = useState<ProductMerge[]>([])
  const [products, setProducts] = useState<ProductListItem[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [lastLoaded, setLastLoaded] = useState<Date | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<ProductMerge | null>(null)
  const [sourceProductId, setSourceProductId] = useState('')
  const [targetProductId, setTargetProductId] = useState('')
  const [reason, setReason] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      const [mergesPage, productsPage] = await Promise.all([catalogApi.listMerges({ pageSize: 100 }), catalogApi.listProducts({ pageSize: 100 })])
      setItems(mergesPage.items)
      setProducts(productsPage.items)
      setLastLoaded(new Date())
      setNotice(null)
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'تعذر تحميل عمليات الدمج.' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const filteredItems = items.filter(item => [item.sourceProduct?.name, item.targetProduct?.name, item.reason].some(field => (field || '').toLowerCase().includes(query.trim().toLowerCase())))
  const closeForm = () => {
    setFormOpen(false)
    setEditing(null)
    setSourceProductId('')
    setTargetProductId('')
    setReason('')
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!sourceProductId || !targetProductId) {
      setNotice({ type: 'error', text: 'يجب اختيار المنتجين.' })
      return
    }
    setSaving(true)
    try {
      // A merge is created pending, then executed or cancelled — never edited.
      await catalogApi.createMerge({ sourceProductId, targetProductId, reason: reason || null })
      setNotice({ type: 'success', text: 'تم إنشاء الدمج.' })
      closeForm()
      await load()
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'تعذر حفظ الدمج.' })
    } finally {
      setSaving(false)
    }
  }

  const cancel = async (item: ProductMerge) => {
    setSaving(true)
    try {
      await catalogApi.cancelMerge(item.id)
      setNotice({ type: 'success', text: 'تم إلغاء الدمج.' })
      await load()
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'تعذر حذف الدمج.' })
    } finally {
      setSaving(false)
    }
  }

  // Executing is the point of a merge: it moves the source product's stock and
  // order lines onto the target and then archives the source. Without this the
  // only reachable outcome for a pending merge was to cancel it.
  const execute = async (item: ProductMerge) => {
    if (!window.confirm(`تنفيذ الدمج: سيتم نقل بيانات «${item.sourceProduct.name}» إلى «${item.targetProduct.name}» وأرشفة المنتج المصدر. هل أنت متأكد؟`)) return
    setSaving(true)
    try {
      await catalogApi.executeMerge(item.id)
      setNotice({ type: 'success', text: 'تم تنفيذ الدمج بنجاح.' })
      await load()
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'تعذر تنفيذ الدمج.' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <ModuleActions count={items.length} countLabel="عملية دمج" onRefresh={() => void load()} loading={loading} saving={saving} onAdd={() => setFormOpen(true)} addLabel="إضافة دمج" />
      <StatusBanner notice={notice} />
      <ListToolbar query={query} setQuery={setQuery} placeholder="ابحث بالمنتجات أو السبب..." lastLoaded={lastLoaded} />
      {formOpen && (
        <form className="ss-multi-editor" onSubmit={submit}>
          <EditorHeader editing={!!editing} singular="دمج المنتجات" />
          <div className="ss-editor-field"><label htmlFor="merge-source">المنتج المصدر</label><select id="merge-source" className="ss-input" value={sourceProductId} onChange={event => setSourceProductId(event.target.value)} required><option value="">اختر المنتج</option>{products.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
          <div className="ss-editor-field"><label htmlFor="merge-target">المنتج الهدف</label><select id="merge-target" className="ss-input" value={targetProductId} onChange={event => setTargetProductId(event.target.value)} required><option value="">اختر المنتج</option>{products.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
          <div className="ss-editor-field ss-multi-editor-full"><label htmlFor="merge-reason">السبب</label><input id="merge-reason" className="ss-input" value={reason} onChange={event => setReason(event.target.value)} /></div>
          <EditorActions closeForm={closeForm} saving={saving} editing={!!editing} />
        </form>
      )}
      <div className="ss-data-surface">
        {loading ? <LoadingState /> : filteredItems.length === 0 ? <EmptyState hasSearch={Boolean(query.trim())} /> : (
          <div className="ss-table-scroll"><table className="ss-table">
            <thead><tr><th>#</th><th>المنتج المصدر</th><th>المنتج الهدف</th><th>السبب</th><th>الحالة</th><th>تاريخ الإنشاء</th><th>تاريخ التنفيذ</th><th className="ss-actions-column">الإجراءات</th></tr></thead>
            <tbody>{filteredItems.map((item, index) => (
              <tr key={item.id}>
                <td><span className="ss-row-number">{index + 1}</span></td>
                <td>{item.sourceProduct?.name || '—'}</td>
                <td>{item.targetProduct?.name || '—'}</td>
                <td>{item.reason || '—'}</td>
                <td>{item.status === 'EXECUTED' ? 'تم الدمج' : item.status === 'CANCELLED' ? 'ملغي' : 'معلق'}</td>
                <td><span>{new Date(item.createdAt).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' })}</span></td>
                <td><span>{item.mergedAt ? new Date(item.mergedAt).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' }) : '—'}</span></td>
                <td className="ss-actions-column">
                  <div className="ss-row-actions">
                    {item.status === 'PENDING' && (
                      <>
                        <button className="ss-icon-button ss-icon-edit" onClick={() => void execute(item)} disabled={saving} aria-label={`تنفيذ دمج ${item.sourceProduct.name}`} title="تنفيذ الدمج">✓</button>
                        <button className="ss-icon-button ss-icon-delete" onClick={() => void cancel(item)} disabled={saving} aria-label={`إلغاء دمج ${item.sourceProduct.name}`} title="إلغاء الدمج">✕</button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
    </div>
  )
}

export default function ProductFamily({ navigate }: { navigate: (path: string) => void }) {
  const [tab, setTab] = useState<ProductFamilyTab>('attributes')
  return (
    <DashboardLayout navigate={navigate}>
      <div className="view-container">
        <section className="ss-module animate-fade-in">
          <ModuleHeading icon={<BoxIcon />} eyebrow="المنتجات" title="خصائص ومتغيرات المنتجات" subtitle="إدارة خصائص المنتجات وقيمها ومتغيراتها وعمليات الدمج." />
          <div className="ss-list-toolbar" style={{ marginTop: '1.25rem', marginBottom: '1rem' }}>
            <button className={`ss-button ${tab === 'attributes' ? 'ss-button-primary' : 'ss-button-ghost'}`} onClick={() => setTab('attributes')}>الخصائص</button>
            <button className={`ss-button ${tab === 'attribute-values' ? 'ss-button-primary' : 'ss-button-ghost'}`} onClick={() => setTab('attribute-values')}>قيم الخصائص</button>
            <button className={`ss-button ${tab === 'variants' ? 'ss-button-primary' : 'ss-button-ghost'}`} onClick={() => setTab('variants')}>المتغيرات</button>
            <button className={`ss-button ${tab === 'merges' ? 'ss-button-primary' : 'ss-button-ghost'}`} onClick={() => setTab('merges')}>الدمج</button>
          </div>
          {tab === 'attributes' && <AttributesTab />}
          {tab === 'attribute-values' && <AttributeValuesTab />}
          {tab === 'variants' && <VariantsTab />}
          {tab === 'merges' && <MergesTab />}
          <p className="ss-eyebrow"><TagIcon /> نموذج تطابق API الملتقط</p>
        </section>
      </div>
    </DashboardLayout>
  )
}
