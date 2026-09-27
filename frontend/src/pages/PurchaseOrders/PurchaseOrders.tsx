import { Fragment, useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import DashboardLayout from "../../components/DashboardLayout/DashboardLayout";
import {
  purchasingApi,
  catalogApi,
  type PurchaseOrder,
  type PurchaseOrderListItem,
  type Vendor,
  type ProductListItem,
  type PurchaseOrderStatus,
} from "../../lib/api";
import {
  ModuleHeading,
  ModuleActions,
  StatusBanner,
  ListToolbar,
  LoadingState,
  EmptyState,
  EditorHeader,
  EditorActions,
  Button,
  PlusIcon,
  TrashIcon,
  ClipboardIcon,
  type Notice,
} from "../shared/ManagementUi";
import "../SystemSettings/SystemSettings.css";

interface PurchaseOrdersProps {
  navigate: (path: string) => void;
}

const PURCHASE_STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  DRAFT: "مسودة",
  ORDERED: "تم الإرسال للمورد",
  PARTIALLY_RECEIVED: "استلام جزئي",
  RECEIVED: "تم الاستلام",
  CANCELLED: "ملغي",
};

interface DraftItem {
  productId: string;
  quantity: string;
  unitPrice: string;
}

function PurchaseOrdersTab() {
  const [items, setItems] = useState<PurchaseOrderListItem[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [products, setProducts] = useState<ProductListItem[]>([]);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<PurchaseOrderStatus | "">("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [totalEntries, setTotalEntries] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [vendorId, setVendorId] = useState("");
  const [notes, setNotes] = useState("");
  const [draftItems, setDraftItems] = useState<DraftItem[]>([
    { productId: "", quantity: "1", unitPrice: "0" },
  ]);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [lastLoaded, setLastLoaded] = useState<Date | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailCache, setDetailCache] = useState<Record<string, PurchaseOrder>>({});
  const [detailLoading, setDetailLoading] = useState(false);

  const toggleItems = async (po: PurchaseOrderListItem) => {
    if (expandedId === po.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(po.id);
    if (!detailCache[po.id]) {
      setDetailLoading(true);
      try {
        const d = await purchasingApi.getPurchaseOrder(po.id);
        setDetailCache((c) => ({ ...c, [po.id]: d }));
      } catch {
        /* row falls back to list data */
      } finally {
        setDetailLoading(false);
      }
    }
  };

  const receiveItem = async (po: PurchaseOrder, itemIndex: number) => {
    const item = detailCache[po.id]?.items[itemIndex];
    if (!item) return;
    const remaining = Number(item.quantity) - Number(item.receivedQuantity);
    if (remaining <= 0) {
      setNotice({ type: "error", text: "تم استلام الكمية كاملة." });
      return;
    }
    const input = window.prompt(
      `كمية الاستلام للصنف «${item.productName}» (المتبقي ${remaining}):`,
      String(remaining),
    );
    if (input === null) return;
    const qty = Number(input);
    if (!Number.isFinite(qty) || qty <= 0 || qty > remaining) {
      setNotice({ type: "error", text: "الكمية غير صالحة." });
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      const updated = await purchasingApi.receivePurchaseOrderItems(po.id, [
        { productId: item.product?.id ?? "", quantity: qty },
      ]);
      setDetailCache((c) => ({ ...c, [po.id]: updated }));
      setNotice({ type: "success", text: "تم تسجيل الاستلام بنجاح." });
      await load(false, page, statusFilter);
    } catch (error) {
      setNotice({
        type: "error",
        text: error instanceof Error ? error.message : "تعذر تسجيل الاستلام.",
      });
    } finally {
      setSaving(false);
    }
  };

  const load = useCallback(
    async (showLoader = true, currentPage = page, currentStatus = statusFilter) => {
      if (showLoader) setLoading(true);
      try {
        const result = await purchasingApi.listPurchaseOrders({
          search: query || undefined,
          status: currentStatus || undefined,
          page: currentPage,
          pageSize: 10,
        });
        setItems(result.items);
        setTotalPages(result.totalPages);
        setTotalEntries(result.total);
        setLastLoaded(new Date());
      } catch (error) {
        setNotice({
          type: "error",
          text: error instanceof Error ? error.message : "تعذر تحميل أوامر الشراء.",
        });
      } finally {
        setLoading(false);
      }
    },
    [query, page, statusFilter],
  );

  const loadReferenceData = useCallback(async () => {
    try {
      const [vendorsResult, productsResult] = await Promise.all([
        purchasingApi.listVendors({ pageSize: 200 }),
        catalogApi.listProducts({ pageSize: 200 }),
      ]);
      setVendors(vendorsResult.items);
      setProducts(productsResult.items);
    } catch {
      /* reference data failures surface on submit */
    }
  }, []);

  useEffect(() => {
    void load();
    void loadReferenceData();
  }, [load, loadReferenceData]);

  const startAdd = () => {
    setFormOpen(true);
    setVendorId("");
    setNotes("");
    setDraftItems([{ productId: "", quantity: "1", unitPrice: "0" }]);
    setNotice(null);
  };
  const closeForm = () => {
    setFormOpen(false);
    setVendorId("");
    setNotes("");
    setDraftItems([{ productId: "", quantity: "1", unitPrice: "0" }]);
  };

  const updateDraftItem = (index: number, patch: Partial<DraftItem>) => {
    setDraftItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };

  const addDraftItem = () =>
    setDraftItems((prev) => [...prev, { productId: "", quantity: "1", unitPrice: "0" }]);
  const removeDraftItem = (index: number) =>
    setDraftItems((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));

  const draftTotal = useMemo(
    () =>
      draftItems.reduce(
        (sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0),
        0,
      ),
    [draftItems],
  );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!vendorId) {
      setNotice({ type: "error", text: "يرجى اختيار المورد." });
      return;
    }
    const validItems = draftItems
      .filter((item) => item.productId && Number(item.quantity) > 0)
      .map((item) => ({
        productId: item.productId,
        quantity: Number(item.quantity),
        unitPrice: Number(item.unitPrice) || 0,
      }));
    if (validItems.length === 0) {
      setNotice({ type: "error", text: "أضف صنفاً واحداً على الأقل مع كمية صحيحة." });
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      await purchasingApi.createPurchaseOrder({ vendorId, notes: notes.trim(), items: validItems });
      setNotice({ type: "success", text: "تم إنشاء أمر الشراء بنجاح." });
      closeForm();
      await load(false);
    } catch (error) {
      setNotice({
        type: "error",
        text: error instanceof Error ? error.message : "تعذر إنشاء أمر الشراء.",
      });
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async (item: PurchaseOrderListItem, status: PurchaseOrderStatus) => {
    setSaving(true);
    setNotice(null);
    try {
      // Status is part of the update payload, not a dedicated endpoint.
      await purchasingApi.updatePurchaseOrder(item.id, { status });
      setNotice({ type: "success", text: "تم تحديث حالة أمر الشراء." });
      await load(false);
    } catch (error) {
      setNotice({
        type: "error",
        text: error instanceof Error ? error.message : "تعذر تحديث الحالة.",
      });
    } finally {
      setSaving(false);
    }
  };

  const remove = async (item: PurchaseOrderListItem) => {
    if (!window.confirm(`هل أنت متأكد من حذف أمر الشراء «${item.orderNumber}»؟`)) return;
    setSaving(true);
    setNotice(null);
    try {
      await purchasingApi.deletePurchaseOrder(item.id);
      setNotice({ type: "success", text: "تم حذف أمر الشراء بنجاح." });
      await load(false);
    } catch (error) {
      setNotice({
        type: "error",
        text: error instanceof Error ? error.message : "تعذر حذف أمر الشراء.",
      });
    } finally {
      setSaving(false);
    }
  };

  const applyStatusFilter = (next: PurchaseOrderStatus | "") => {
    setStatusFilter(next);
    setPage(1);
    void load(true, 1, next);
  };

  const goToPage = (next: number) => {
    setPage(next);
    void load(true, next, statusFilter);
  };

  return {
    items,
    vendors,
    products,
    query,
    setQuery,
    statusFilter,
    applyStatusFilter,
    page,
    totalPages,
    totalEntries,
    loading,
    saving,
    formOpen,
    vendorId,
    setVendorId,
    notes,
    setNotes,
    draftItems,
    updateDraftItem,
    addDraftItem,
    removeDraftItem,
    draftTotal,
    notice,
    lastLoaded,
    load,
    startAdd,
    closeForm,
    submit,
    changeStatus,
    remove,
    goToPage,
    expandedId,
    detailCache,
    detailLoading,
    toggleItems,
    receiveItem,
  };
}

function PurchaseOrdersView() {
  const t = PurchaseOrdersTab();
  return (
    <section className="ss-module animate-fade-in">
      <ModuleHeading
        icon={<ClipboardIcon />}
        eyebrow="المشتريات"
        title="أوامر الشراء (Purchase Orders)"
        subtitle="إنشاء ومتابعة أوامر شراء المنتجات من الموردين وحالات الاستلام."
      />
      <ModuleActions
        count={t.totalEntries}
        countLabel="أمر شراء"
        onRefresh={() => void t.load()}
        loading={t.loading}
        saving={t.saving}
        onAdd={t.startAdd}
        addLabel="أمر شراء جديد"
      />
      <StatusBanner notice={t.notice} />
      <div className="ss-list-toolbar">
        <ListToolbar
          query={t.query}
          setQuery={t.setQuery}
          placeholder="ابحث برقم الأمر أو اسم المورد..."
          lastLoaded={t.lastLoaded}
        />
        <label className="ss-search" style={{ minWidth: "170px" }}>
          <span>الحالة:</span>
          <select
            value={t.statusFilter}
            onChange={(event) =>
              t.applyStatusFilter(event.target.value as PurchaseOrderStatus | "")
            }
            aria-label="تصفية بالحالة"
            className="ss-input"
          >
            <option value="">الكل</option>
            {Object.entries(PURCHASE_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {t.formOpen && (
        <form className="ss-multi-editor" onSubmit={t.submit}>
          <EditorHeader editing={false} singular="أمر شراء" />
          <div className="ss-editor-field">
            <label htmlFor="po-vendor">المورد</label>
            <select
              id="po-vendor"
              className="ss-input"
              value={t.vendorId}
              onChange={(event) => t.setVendorId(event.target.value)}
              disabled={t.saving}
            >
              <option value="">— اختر المورد —</option>
              {t.vendors.map((vendor) => (
                <option key={vendor.id} value={vendor.id}>
                  {vendor.name}
                </option>
              ))}
            </select>
          </div>
          <div className="ss-editor-field">
            <label htmlFor="po-notes">ملاحظات</label>
            <input
              id="po-notes"
              className="ss-input"
              value={t.notes}
              onChange={(event) => t.setNotes(event.target.value)}
              placeholder="اختياري"
              disabled={t.saving}
            />
          </div>
          <div className="ss-multi-editor-full">
            <span className="ss-editor-kicker">أصناف أمر الشراء</span>
          </div>
          {t.draftItems.map((item, index) => (
            <div
              className="ss-editor-field ss-multi-editor-full"
              key={index}
              style={{
                display: "grid",
                gridTemplateColumns: "2fr 1fr 1fr auto",
                gap: "0.5rem",
                alignItems: "end",
              }}
            >
              <div>
                <label htmlFor={`po-product-${index}`}>المنتج</label>
                <select
                  id={`po-product-${index}`}
                  className="ss-input"
                  value={item.productId}
                  onChange={(event) => t.updateDraftItem(index, { productId: event.target.value })}
                  disabled={t.saving}
                >
                  <option value="">— اختر المنتج —</option>
                  {t.products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor={`po-qty-${index}`}>الكمية</label>
                <input
                  id={`po-qty-${index}`}
                  className="ss-input"
                  type="number"
                  min="1"
                  step="1"
                  value={item.quantity}
                  onChange={(event) => t.updateDraftItem(index, { quantity: event.target.value })}
                  disabled={t.saving}
                />
              </div>
              <div>
                <label htmlFor={`po-price-${index}`}>سعر الوحدة</label>
                <input
                  id={`po-price-${index}`}
                  className="ss-input"
                  type="number"
                  min="0"
                  step="0.01"
                  value={item.unitPrice}
                  onChange={(event) => t.updateDraftItem(index, { unitPrice: event.target.value })}
                  disabled={t.saving}
                />
              </div>
              <button
                type="button"
                className="ss-icon-button ss-icon-delete"
                onClick={() => t.removeDraftItem(index)}
                disabled={t.saving}
                aria-label="إزالة الصف"
                title="إزالة الصف"
                style={{ marginBottom: "4px" }}
              >
                <TrashIcon />
              </button>
            </div>
          ))}
          <div
            className="ss-multi-editor-full"
            style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
          >
            <Button variant="secondary" onClick={t.addDraftItem} disabled={t.saving}>
              <PlusIcon size={16} /> إضافة صنف
            </Button>
            <span className="ss-count-chip">
              الإجمالي:{" "}
              <strong>
                {t.draftTotal.toLocaleString("ar-EG", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </strong>
            </span>
          </div>
          <EditorActions closeForm={t.closeForm} saving={t.saving} editing={false} />
        </form>
      )}
      <div className="ss-data-surface">
        {t.loading ? (
          <LoadingState />
        ) : t.items.length === 0 ? (
          <EmptyState hasSearch={Boolean(t.query.trim())} />
        ) : (
          <div className="ss-table-scroll">
            <table className="ss-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>رقم الأمر</th>
                  <th>المورد</th>
                  <th>الأصناف</th>
                  <th>الإجمالي</th>
                  <th>الحالة</th>
                  <th>التاريخ</th>
                  <th className="ss-actions-column">الإجراءات</th>
                </tr>
              </thead>
              <tbody>
                {t.items.map((item, index) => {
                  return (
                    <Fragment key={item.id}>
                      <tr>
                        <td>
                          <span className="ss-row-number">{(t.page - 1) * 10 + index + 1}</span>
                        </td>
                        <td>
                          <button
                            className="ss-item-name"
                            dir="ltr"
                            onClick={() => void t.toggleItems(item)}
                            style={{
                              background: "none",
                              border: "none",
                              cursor: "pointer",
                              padding: 0,
                              color: "var(--color-accent)",
                              textDecoration: "underline",
                              fontFamily: "monospace",
                            }}
                            title="عرض الأصناف"
                          >
                            {item.orderNumber}
                          </button>
                        </td>
                        <td>
                          <span>{item.vendor.name}</span>
                        </td>
                        <td>
                          <span>{item._count.items}</span>
                        </td>
                        <td>
                          <span>
                            {Number(item.totalAmount).toLocaleString("ar-EG", {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </span>
                        </td>
                        <td>
                          <select
                            className="ss-input"
                            value={item.status}
                            onChange={(event) =>
                              void t.changeStatus(item, event.target.value as PurchaseOrderStatus)
                            }
                            disabled={t.saving}
                            aria-label={`حالة ${item.orderNumber}`}
                            style={{ minWidth: "130px", padding: "0.25rem 0.5rem" }}
                          >
                            {Object.entries(PURCHASE_STATUS_LABELS).map(([value, label]) => (
                              <option key={value} value={value}>
                                {label}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <span>{new Date(item.createdAt).toLocaleDateString("ar-EG")}</span>
                        </td>
                        <td className="ss-actions-column">
                          <div className="ss-row-actions">
                            <button
                              className="ss-icon-button ss-icon-delete"
                              onClick={() => void t.remove(item)}
                              disabled={t.saving}
                              aria-label={`حذف ${item.orderNumber}`}
                              title="حذف"
                            >
                              <TrashIcon />
                            </button>
                          </div>
                        </td>
                      </tr>
                      {t.expandedId === item.id && (
                        <tr>
                          <td colSpan={8}>
                            <div
                              style={{
                                background: "var(--bg-secondary)",
                                borderRadius: 10,
                                padding: "0.9rem",
                              }}
                            >
                              {t.detailLoading && !t.detailCache[item.id] && (
                                <div
                                  style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}
                                >
                                  جارٍ تحميل الأصناف...
                                </div>
                              )}
                              {t.detailCache[item.id] && (
                                <table className="ss-table" style={{ fontSize: "0.8rem" }}>
                                  <thead>
                                    <tr>
                                      <th>الصنف</th>
                                      <th>SKU</th>
                                      <th>الكمية</th>
                                      <th>المستلم</th>
                                      <th>المتبقي</th>
                                      <th>سعر الوحدة</th>
                                      <th>الإجمالي</th>
                                      <th></th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {t.detailCache[item.id].items.map((it, idx) => {
                                      const qty = Number(it.quantity);
                                      const rec = Number(it.receivedQuantity);
                                      const remaining = qty - rec;
                                      return (
                                        <tr key={it.id}>
                                          <td>{it.productName}</td>
                                          <td dir="ltr" style={{ fontFamily: "monospace" }}>
                                            {it.skuCode ?? "—"}
                                          </td>
                                          <td>{qty}</td>
                                          <td>{rec}</td>
                                          <td
                                            style={{ color: remaining > 0 ? "#e65100" : "var(--color-success)" }}
                                          >
                                            {remaining}
                                          </td>
                                          <td>{Number(it.unitPrice).toLocaleString("ar-EG")}</td>
                                          <td>{Number(it.total).toLocaleString("ar-EG")}</td>
                                          <td>
                                            {remaining > 0 && item.status !== "CANCELLED" && (
                                              <button
                                                className="ss-icon-button"
                                                style={{
                                                  color: "var(--color-success)",
                                                  fontWeight: 700,
                                                  fontSize: "0.7rem",
                                                }}
                                                disabled={t.saving}
                                                onClick={() =>
                                                  void t.receiveItem(t.detailCache[item.id], idx)
                                                }
                                                title="تسجيل استلام"
                                              >
                                                استلام
                                              </button>
                                            )}
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {t.totalPages > 1 && (
        <div className="ss-list-toolbar" style={{ justifyContent: "center" }}>
          <Button
            variant="ghost"
            onClick={() => t.goToPage(t.page - 1)}
            disabled={t.page <= 1 || t.loading}
          >
            السابق
          </Button>
          <span className="ss-count-chip">
            صفحة {t.page} من {t.totalPages} — {t.totalEntries} أمر
          </span>
          <Button
            variant="ghost"
            onClick={() => t.goToPage(t.page + 1)}
            disabled={t.page >= t.totalPages || t.loading}
          >
            التالي
          </Button>
        </div>
      )}
    </section>
  );
}

export default function PurchaseOrders({ navigate }: PurchaseOrdersProps) {
  return (
    <DashboardLayout navigate={navigate}>
      <div className="view-container">
        <PurchaseOrdersView />
      </div>
    </DashboardLayout>
  );
}
