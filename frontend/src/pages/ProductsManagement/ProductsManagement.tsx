import { Fragment, useCallback, useEffect, useState, type ReactNode } from "react";
import DashboardLayout from "../../components/DashboardLayout/DashboardLayout";
import RemoteImage from "../../components/RemoteImage/RemoteImage";
import { Select } from "../../components/Select/Select";
import { DataGridToolbar, GridBulkBar, useDataGrid } from "../../components/DataGrid/DataGrid";
import {
  catalogApi,
  settingsApi,
  systemApi,
  type Brand,
  type Category,
  type Product,
  type ProductListItem,
  type Store,
} from "../../lib/api";
import { useCurrentUser } from "../../hooks/useCurrentUser";
import { toArabicNumerals } from "../../utils/arabicNumerals";
import "../../styles/DashboardViews.css";
import "../AccountingOverview/AccountingOverview.css";
import { ProductImage } from "../../components/ProductImage";
import { useImageUpload } from "../../lib/useImageUpload";

type Notice = {
  type: "success" | "error" | "info";
  text: string;
};

function Icon({ children, size = 18 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

const RefreshIcon = () => (
  <Icon>
    <path d="M20 11a8.1 8.1 0 0 0-14.8-4L3 10" />
    <path d="M3 5v5h5" />
    <path d="M4 13a8.1 8.1 0 0 0 14.8 4L21 14" />
    <path d="M21 19v-5h-5" />
  </Icon>
);
const EditIcon = () => (
  <Icon size={16}>
    <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
  </Icon>
);
const TrashIcon = () => (
  <Icon size={16}>
    <path d="M4 7h16M10 11v5M14 11v5M6 7l1 13h10l1-13M9 7V4h6v3" />
  </Icon>
);
const PrintIcon = () => (
  <Icon size={16}>
    <polyline points="6 9 6 2 18 2 18 9" />
    <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
    <rect x="6" y="14" width="12" height="8" />
  </Icon>
);

function StatusBanner({ notice }: { notice: Notice | null }) {
  if (!notice) return null;
  return (
    <div
      style={{
        padding: "0.5rem 1rem",
        fontSize: "0.8rem",
        background:
          notice.type === "success" ? "#e6ffe6" : notice.type === "error" ? "var(--color-danger-soft)" : "#e6f3ff",
        borderBottom: "1px solid var(--border-color)",
      }}
    >
      {notice.text}
    </div>
  );
}

/** Money arrives as a string on the wire because the column is a Decimal. */
function money(value: string | null | undefined, suffix = " ج.م") {
  if (value === null || value === undefined || value === "") return "—";
  return `${toArabicNumerals(Number(value).toFixed(2))}${suffix}`;
}

export default function ProductsManagement({ navigate }: { navigate: (path: string) => void }) {
  const [entries, setEntries] = useState<ProductListItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [brandFilter, setBrandFilter] = useState("");
  const [activeFilter, setActiveFilter] = useState<boolean | undefined>(undefined);

  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [total, setTotal] = useState(0);
  const pageSize = 10;

  // Resolved by the server from the caller's roles and ownership, not read out
  // of a localStorage copy that goes stale the moment a role is revoked.
  const { hasPermission } = useCurrentUser();
  const hasDelete = hasPermission("Permissions.DeleteProduct");
  const hasUpdate = hasPermission("Permissions.UpdateProduct");

  // Edit modal state
  const [editingItem, setEditingItem] = useState<ProductListItem | null>(null);
  const [editName, setEditName] = useState("");
  const [editSku, setEditSku] = useState("");
  const [editBarcode, setEditBarcode] = useState("");
  const [editPrice, setEditPrice] = useState("");
  const [editPriceBefore, setEditPriceBefore] = useState("");
  const [editCost, setEditCost] = useState("");
  const [editWeight, setEditWeight] = useState("");
  const [editTrackExpiry, setEditTrackExpiry] = useState(false);
  const [editDesc, setEditDesc] = useState("");
  const [editCategoryId, setEditCategoryId] = useState("");
  const [editBrandId, setEditBrandId] = useState("");
  const [editIsActive, setEditIsActive] = useState(true);
  const [editImageUrls, setEditImageUrls] = useState<string[]>([]);
  const [uploadingEditImages, setUploadingEditImages] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailCache, setDetailCache] = useState<Record<string, Product>>({});
  const { upload: uploadImage } = useImageUpload();

  const toggleDetails = async (item: ProductListItem) => {
    if (expandedId === item.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(item.id);
    if (!detailCache[item.id]) {
      try {
        const d = await catalogApi.getProduct(item.id);
        setDetailCache((c) => ({ ...c, [item.id]: d }));
      } catch {
        /* row falls back to list data */
      }
    }
  };

  const openEdit = async (item: ProductListItem) => {
    setEditingItem(item);
    setEditName(item.name);
    setEditSku(item.skuCode ?? "");
    setEditBarcode(item.barcode ?? "");
    setEditPrice(String(item.price));
    setEditPriceBefore(item.priceBeforeDiscount ?? "");
    setEditCost(String(item.costPrice));
    setEditWeight("");
    setEditTrackExpiry(false);
    setEditCategoryId(item.category?.id ?? "");
    setEditBrandId(item.brand?.id ?? "");
    setEditIsActive(item.isActive);
    setEditImageUrls([]);

    // The list row carries no description and no gallery, so those come from
    // the detail endpoint before the form can be trusted with them.
    try {
      const details = await catalogApi.getProduct(item.id);
      setEditDesc(details.description ?? "");
      setEditWeight(details.weightKg != null ? String(details.weightKg) : "");
      setEditTrackExpiry(details.trackExpiry ?? false);
      setEditImageUrls(details.images.map((img) => img.imageUrl));
    } catch {
      setEditDesc("");
    }
  };

  const closeEdit = () => {
    setEditingItem(null);
  };

  const saveEdit = async () => {
    const item = editingItem;
    if (!item) return;
    if (!editName.trim() || !editSku.trim() || !editPrice || !editCost) {
      alert("يرجى إدخال الحقول المطلوبة: الاسم، كود SKU، السعر، وسعر التكلفة.");
      return;
    }
    setSaving(true);
    try {
      await catalogApi.updateProduct(item.id, {
        name: editName.trim(),
        skuCode: editSku.trim(),
        barcode: editBarcode.trim() || null,
        price: Number(editPrice),
        priceBeforeDiscount: editPriceBefore ? Number(editPriceBefore) : null,
        costPrice: Number(editCost),
        weightKg: editWeight.trim() === "" ? null : Number(editWeight),
        trackExpiry: editTrackExpiry,
        description: editDesc.trim() || null,
        categoryId: editCategoryId || null,
        brandId: editBrandId || null,
        isActive: editIsActive,
        images: editImageUrls.map((imageUrl, index) => ({ imageUrl, isPrimary: index === 0 })),
      });
      setNotice({ type: "success", text: "تم تعديل المنتج بنجاح." });
      closeEdit();
      load();
    } catch (error) {
      setNotice({
        type: "error",
        text: error instanceof Error ? error.message : "تعذر تعديل المنتج.",
      });
    } finally {
      setSaving(false);
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [productPage, categoryPage, brandPage] = await Promise.all([
        catalogApi.listProducts({
          search: search || undefined,
          categoryId: categoryFilter || undefined,
          brandId: brandFilter || undefined,
          isActive: activeFilter,
          page,
          pageSize,
        }),
        catalogApi.listCategories({ pageSize: 200 }),
        catalogApi.listBrands({ pageSize: 200 }),
      ]);
      setEntries(productPage.items);
      setTotalPages(productPage.totalPages);
      setTotal(productPage.total);
      setCategories(categoryPage.items);
      setBrands(brandPage.items);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [search, categoryFilter, brandFilter, activeFilter, page, pageSize]);

  useEffect(() => {
    load();
  }, [load]);

  const grid = useDataGrid<ProductListItem>({
    storageKey: "products",
    rowKey: (p) => p.id,
    columns: [
      { key: "image", label: "الصورة" },
      { key: "skuCode", label: "رمز SKU" },
      { key: "barcode", label: "الباركود" },
      { key: "name", label: "الاسم" },
      {
        key: "categoryName",
        label: "القسم",
        value: (p) => p.category?.name ?? "—",
      },
      { key: "brandName", label: "الماركة", value: (p) => p.brand?.name ?? "—" },
      { key: "price", label: "سعر البيع" },
      { key: "priceBeforeDiscount", label: "سعر قبل الخصم" },
      { key: "costPrice", label: "التكلفة" },
      {
        key: "createdAt",
        label: "تاريخ الإضافة",
        value: (p) => new Date(p.createdAt).toLocaleDateString("ar-EG"),
      },
      { key: "available", label: "الرصيد المتاح" },
      { key: "isActive", label: "الحالة", value: (p) => (p.isActive ? "نشط" : "غير نشط") },
    ],
  });
  const show = (key: string) => grid.visibleColumns.some((c) => c.key === key);
  const gridRows = grid.applyFilters(entries);
  const allOnPageSelected = entries.length > 0 && entries.every((e) => grid.selected.has(e.id));

  const [showStoreModal, setShowStoreModal] = useState(false);
  const [stores, setStores] = useState<Store[]>([]);
  // The deployment-level Shopify switch. Read when the modal opens so the
  // message states the REAL reason the push is unavailable instead of guessing.
  const [shopifyEnabled, setShopifyEnabled] = useState(true);
  // Which store is mid-push, and the result of the last push, shown in the modal.
  const [pushingStoreId, setPushingStoreId] = useState<string | null>(null);
  const [pushResult, setPushResult] = useState<string | null>(null);

  const openStoreModal = async () => {
    setShowStoreModal(true);
    setPushResult(null);
    try {
      const storePage = await systemApi.listStores({ pageSize: 100 });
      setStores(storePage.items);
    } catch {
      setStores([]);
    }
    try {
      const settings = await settingsApi.get();
      setShopifyEnabled(settings.shopifyEnabled);
    } catch {
      // Leave the optimistic default; the per-store label still says the push
      // is unavailable, so a failed read cannot make the UI claim it works.
    }
  };

  const exportToStore = async (storeId: string) => {
    // grid.selected is Set<string | number>; product ids are strings.
    const productIds = [...grid.selected].map(String);
    if (productIds.length === 0) return;
    setPushingStoreId(storeId);
    setPushResult(null);
    try {
      const r = await systemApi.exportProductsToStore(storeId, productIds);
      // Report what actually happened, including the per-product failures —
      // "تم التصدير" alone would hide a batch that half-failed.
      const parts = [`${r.created} أُنشئ`, `${r.updated} حُدِّث`];
      if (r.skipped) parts.push(`${r.skipped} تم تخطيه`);
      if (r.failed) parts.push(`${r.failed} فشل`);
      setPushResult(`تم التصدير: ${parts.join('، ')}.`);
      if (r.errors.length) {
        setPushResult((prev) => `${prev} ${r.errors.map((e) => e.sku ?? e.productId).join('، ')}`);
      }
      await load();
    } catch (err) {
      setPushResult(err instanceof Error ? err.message : 'تعذر تصدير المنتجات.');
    } finally {
      setPushingStoreId(null);
    }
  };

  const archiveBulk = async (archived: boolean) => {
    const targets = entries.filter((e) => grid.selected.has(e.id));
    if (!targets.length) return;
    const verb = archived ? "أرشفة" : "إلغاء أرشفة";
    if (!window.confirm(`سيتم ${verb} ${targets.length} منتج. متابعة؟`)) return;
    setSaving(true);
    setNotice(null);
    let failed = 0;
    try {
      for (const item of targets) {
        try {
          if (archived) await catalogApi.archiveProduct(item.id);
          else await catalogApi.unarchiveProduct(item.id);
        } catch {
          failed++;
        }
      }
      setNotice(
        failed
          ? { type: "error", text: `تم ${verb} بعض المنتجات، فشل ${failed}.` }
          : { type: "success", text: `تم ${verb} ${targets.length} منتج بنجاح.` },
      );
      grid.clearSelection();
      load();
    } finally {
      setSaving(false);
    }
  };

  const printBarcode = (product: ProductListItem) => {
    // A barcode is only printable if there is actually something to encode.
    // JsBarcode throws on an empty string ("\"\" is not a valid input for CODE128"),
    // and because that call sits on the same line as the print handler, the throw
    // used to kill the rest of the script — the window opened blank and print()
    // never ran. Guard first, and never let the barcode failure suppress printing.
    const code = (product.barcode || product.skuCode || "").trim();
    if (!code) {
      alert("لا يمكن طباعة الباركود: هذا المنتج بلا باركود أو كود صنف.");
      return;
    }
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      alert("يرجى السماح بالنوافذ المنبثقة لطباعة الباركود.");
      return;
    }
    const htmlContent = `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><title>طباعة باركود - ${product.name}</title><style>@page{margin:0}html,body{margin:0;padding:0;width:100%;height:100%}body{font-family:'Inter',system-ui,-apple-system,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;background:#fff;box-sizing:border-box;min-height:100vh}.product-title{font-size:1.6rem;font-weight:700;margin:0 0 12px;color:#000;line-height:1.3}.sku-code{font-size:1rem;color:#000;background:#e6e6e6;padding:.25rem .6rem;border-radius:4px;display:inline-block;font-family:monospace;margin-bottom:14px}.price-tag{font-size:1.9rem;font-weight:800;color:#000;margin-bottom:16px}#barcode{max-width:100%}</style></head><body><div class="product-title">${product.name}</div><div class="sku-code">${product.skuCode ?? ""}</div><div class="price-tag">${money(product.price)}</div><svg id="barcode"></svg><script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js"></script><script>function mzPrint(){setTimeout(function(){window.print();window.close()},350)}try{JsBarcode("#barcode","${code}",{format:"CODE128",width:2,height:70,displayValue:true,fontSize:16,fontOptions:"bold",textMargin:4})}catch(e){}window.onload=mzPrint</script></body></html>`;
    printWindow.document.open();
    printWindow.document.write(htmlContent);
    printWindow.document.close();
  };

  const remove = async (item: ProductListItem) => {
    if (!hasDelete) return;
    if (!window.confirm(`هل أنت متأكد من حذف المنتج «${item.name}»؟`)) return;
    setSaving(true);
    setNotice(null);
    try {
      await catalogApi.deleteProduct(item.id);
      setNotice({ type: "success", text: "تم حذف المنتج بنجاح." });
      load();
    } catch (error) {
      setNotice({
        type: "error",
        text: error instanceof Error ? error.message : "تعذر حذف المنتج.",
      });
    } finally {
      setSaving(false);
    }
  };

  const disabled = loading || saving;

  return (
    <DashboardLayout navigate={navigate}>
      <div className="view-container">
        <div className="view-header" style={{ marginBottom: "1.5rem" }}>
          <div>
            <h1 className="view-header-title">إدارة المنتجات</h1>
            <p className="view-header-subtitle">
              دليل المنتجات — عرض وتصفية وبحث في جميع المنتجات المسجلة على النظام.
            </p>
          </div>
        </div>

        <div className="io-data-surface">
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "0.75rem 1rem",
              background: "var(--bg-secondary)",
              borderBottom: "1px solid var(--border-color)",
            }}
          >
            <strong style={{ fontSize: "0.85rem" }}>قائمة المنتجات</strong>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                {toArabicNumerals(total)} منتج
              </span>
              <button
                type="button"
                className="io-button io-button-ghost"
                onClick={load}
                disabled={disabled}
                style={{ fontSize: "0.8rem", padding: "0.3rem 0.6rem" }}
              >
                <RefreshIcon /> تحديث
              </button>
            </div>
          </div>

          <div className="ao-filter-bar" style={{ flexWrap: "wrap" }}>
            <input
              type="text"
              placeholder="ابحث باسم المنتج، كود SKU، الباركود..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
            <div style={{ width: 160, flexShrink: 0 }}>
              <Select
                value={categoryFilter}
                onChange={(v) => {
                  setCategoryFilter(String(v ?? ""));
                  setPage(1);
                }}
                options={[
                  { value: "", label: "كل الأقسام" },
                  ...categories.map((c) => ({ value: c.id, label: c.name })),
                ]}
              />
            </div>
            <div style={{ width: 160, flexShrink: 0 }}>
              <Select
                value={brandFilter}
                onChange={(v) => {
                  setBrandFilter(String(v ?? ""));
                  setPage(1);
                }}
                options={[
                  { value: "", label: "كل الماركات" },
                  ...brands.map((b) => ({ value: b.id, label: b.name })),
                ]}
              />
            </div>
            <select
              style={{
                padding: "0.5rem 0.75rem",
                border: "1px solid var(--border-color)",
                borderRadius: 6,
                background: "var(--bg-primary)",
                fontSize: "0.8rem",
                fontFamily: "var(--font-body)",
                width: 110,
                flexShrink: 0,
              }}
              value={activeFilter === undefined ? -1 : activeFilter ? 1 : 0}
              onChange={(e) => {
                const v = Number(e.target.value);
                setActiveFilter(v === -1 ? undefined : v === 1);
                setPage(1);
              }}
            >
              <option value={-1}>الكل</option>
              <option value={1}>نشط</option>
              <option value={0}>غير نشط</option>
            </select>
          </div>

          <DataGridToolbar
            grid={grid}
            rows={gridRows}
            actions={
              <button type="button" className="dg-btn" onClick={openStoreModal}>
                🏪 تصدير الى المتجر
              </button>
            }
          />
          <GridBulkBar count={grid.selected.size} onClear={grid.clearSelection}>
            <button
              type="button"
              className="dg-btn"
              onClick={() => void archiveBulk(true)}
              disabled={saving || !hasUpdate}
            >
              أرشفة
            </button>
            <button
              type="button"
              className="dg-btn"
              onClick={() => void archiveBulk(false)}
              disabled={saving || !hasUpdate}
            >
              إلغاء الأرشفة
            </button>
          </GridBulkBar>

          <StatusBanner notice={notice} />

          {loading ? (
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                minHeight: "150px",
                color: "var(--text-secondary)",
                fontSize: "0.85rem",
              }}
            >
              جاري التحميل...
            </div>
          ) : entries.length === 0 ? (
            <div className="io-empty-state">
              <h3>لا توجد نتائج</h3>
              <p>لم يتم العثور على منتجات تطابق معايير البحث.</p>
            </div>
          ) : (
            <>
              <div className="io-table-scroll ao-table-scroll">
                <table className="io-table">
                  <thead>
                    <tr>
                      <th style={{ width: 32 }}>
                        <input
                          type="checkbox"
                          checked={allOnPageSelected}
                          onChange={() => grid.toggleAll(entries)}
                          aria-label="تحديد الكل"
                        />
                      </th>
                      <th>#</th>
                      {show("image") && <th>الصورة</th>}
                      {show("skuCode") && <th>رمز SKU</th>}
                      {show("barcode") && <th>الباركود</th>}
                      {show("name") && <th>الاسم</th>}
                      {show("categoryName") && <th>القسم</th>}
                      {show("brandName") && <th>الماركة</th>}
                      {show("price") && <th>سعر البيع</th>}
                      {show("priceBeforeDiscount") && <th>سعر قبل الخصم</th>}
                      {show("costPrice") && <th>التكلفة</th>}
                      {show("createdAt") && <th>تاريخ الإضافة</th>}
                      {show("available") && <th>الرصيد المتاح</th>}
                      {show("isActive") && <th>الحالة</th>}
                      <th className="io-actions-column">الإجراءات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gridRows.map((item, index) => {
                      return (
                        <Fragment key={item.id}>
                          <tr>
                            <td>
                              <input
                                type="checkbox"
                                checked={grid.selected.has(item.id)}
                                onChange={() => grid.toggleRow(item)}
                                aria-label={`تحديد ${item.name}`}
                              />
                            </td>
                            <td>
                              <span className="io-row-number">
                                {(page - 1) * pageSize + index + 1}
                              </span>
                            </td>
                            {show("image") && (
                              <td>
                                <RemoteImage
                                  path={item.primaryImage}
                                  className="io-thumbnail"
                                  alt={item.name}
                                />
                              </td>
                            )}
                            {show("skuCode") && (
                              <td>
                                <span style={{ fontFamily: "monospace", fontSize: "0.8rem" }}>
                                  {item.skuCode ?? "—"}
                                </span>
                              </td>
                            )}
                            {show("barcode") && (
                              <td>
                                <span style={{ fontFamily: "monospace", fontSize: "0.8rem" }}>
                                  {item.barcode || "—"}
                                </span>
                              </td>
                            )}
                            {show("name") && (
                              <td>
                                <span className="io-item-name">{item.name}</span>
                              </td>
                            )}
                            {show("categoryName") && (
                              <td>
                                <span>{item.category?.name ?? "—"}</span>
                              </td>
                            )}
                            {show("brandName") && (
                              <td>
                                <span>{item.brand?.name ?? "—"}</span>
                              </td>
                            )}
                            {show("price") && (
                              <td>
                                <span>{money(item.price)}</span>
                              </td>
                            )}
                            {show("priceBeforeDiscount") && (
                              <td>
                                <span>{money(item.priceBeforeDiscount)}</span>
                              </td>
                            )}
                            {show("costPrice") && (
                              <td>
                                <span>{money(item.costPrice)}</span>
                              </td>
                            )}
                            {show("createdAt") && (
                              <td>
                                <span style={{ fontSize: "0.8rem" }}>
                                  {new Date(item.createdAt).toLocaleDateString("ar-EG")}
                                </span>
                              </td>
                            )}
                            {show("available") && (
                              <td>
                                <span style={{ fontSize: "0.8rem" }}>
                                  <strong>{toArabicNumerals(item.available)}</strong> قطعة
                                </span>
                              </td>
                            )}
                            {show("isActive") && (
                              <td>
                                <span
                                  style={{
                                    background: "var(--bg-secondary)",
                                    padding: "2px 6px",
                                    borderRadius: "4px",
                                    fontSize: "0.85rem",
                                  }}
                                >
                                  {item.isActive ? "نشط" : "غير نشط"}
                                </span>
                              </td>
                            )}
                            <td className="io-actions-column">
                              <div className="io-row-actions">
                                <button
                                  className="io-icon-button"
                                  style={{ color: "var(--color-accent)", fontWeight: 700, fontSize: "0.7rem" }}
                                  onClick={() => void toggleDetails(item)}
                                  aria-label={`تفاصيل ${item.name}`}
                                  title="تفاصيل"
                                >
                                  تفاصيل
                                </button>
                                <button
                                  className="io-icon-button"
                                  style={{ color: "var(--ss-moss)" }}
                                  onClick={() => printBarcode(item)}
                                  disabled={saving}
                                  aria-label={`طباعة باركود ${item.name}`}
                                  title="طباعة باركود"
                                >
                                  <PrintIcon />
                                </button>
                                {hasUpdate && (
                                  <button
                                    className="io-icon-button"
                                    style={{ color: "var(--text-secondary)" }}
                                    onClick={() => void openEdit(item)}
                                    disabled={saving}
                                    aria-label={`تعديل ${item.name}`}
                                    title="تعديل"
                                  >
                                    <EditIcon />
                                  </button>
                                )}
                                {hasDelete && (
                                  <button
                                    className="io-icon-button io-icon-delete"
                                    onClick={() => void remove(item)}
                                    disabled={saving}
                                    aria-label={`حذف ${item.name}`}
                                    title="حذف"
                                  >
                                    <TrashIcon />
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                          {expandedId === item.id &&
                            (() => {
                              const d = detailCache[item.id];
                              return (
                                <tr key={`${item.id}-details`}>
                                  <td colSpan={13}>
                                    {!d ? (
                                      <div
                                        style={{
                                          padding: "0.75rem",
                                          color: "var(--text-secondary)",
                                          fontSize: "0.85rem",
                                        }}
                                      >
                                        جارٍ تحميل التفاصيل...
                                      </div>
                                    ) : (
                                      <div
                                        style={{
                                          background: "var(--bg-secondary)",
                                          borderRadius: 10,
                                          padding: "0.9rem",
                                          display: "flex",
                                          flexDirection: "column",
                                          gap: "0.75rem",
                                        }}
                                      >
                                        <div
                                          style={{
                                            display: "flex",
                                            gap: "1.5rem",
                                            flexWrap: "wrap",
                                            fontSize: "0.85rem",
                                          }}
                                        >
                                          {d.description && (
                                            <div style={{ flex: "1 1 100%" }}>
                                              <strong>الوصف:</strong> {d.description}
                                            </div>
                                          )}
                                          <div>
                                            <strong>الوزن:</strong>{" "}
                                            {d.weightKg ? `${Number(d.weightKg)} كجم` : "—"}
                                          </div>
                                          <div>
                                            <strong>تتبع الصلاحية:</strong>{" "}
                                            {d.trackExpiry ? "نعم" : "لا"}
                                          </div>
                                          <div>
                                            <strong>ضريبة البيع:</strong>{" "}
                                            {d.salesTaxRate
                                              ? `${d.salesTaxRate.name} (${Number(d.salesTaxRate.percentage)}%)`
                                              : "—"}
                                          </div>
                                          <div>
                                            <strong>ضريبة الشراء:</strong>{" "}
                                            {d.purchaseTaxRate
                                              ? `${d.purchaseTaxRate.name} (${Number(d.purchaseTaxRate.percentage)}%)`
                                              : "—"}
                                          </div>
                                          <div>
                                            <strong>عدد الصور:</strong> {d.images.length}
                                          </div>
                                        </div>

                                        <div>
                                          <strong style={{ fontSize: "0.85rem" }}>
                                            المخزون حسب الموقع
                                          </strong>
                                          {d.stockLevels.length === 0 ? (
                                            <div
                                              style={{
                                                fontSize: "0.8rem",
                                                color: "var(--text-secondary)",
                                              }}
                                            >
                                              لا توجد مستويات مخزون مسجلة.
                                            </div>
                                          ) : (
                                            <table
                                              className="ss-table"
                                              style={{ marginTop: "0.4rem", fontSize: "0.8rem" }}
                                            >
                                              <thead>
                                                <tr>
                                                  <th>المستودع</th>
                                                  <th>الموقع</th>
                                                  <th>المتاح</th>
                                                  <th>محجوز</th>
                                                </tr>
                                              </thead>
                                              <tbody>
                                                {d.stockLevels.map((sl, idx) => (
                                                  <tr key={idx}>
                                                    <td>{sl.storageLocation.warehouse.name}</td>
                                                    <td>{sl.storageLocation.name}</td>
                                                    <td>{Number(sl.onHand)}</td>
                                                    <td>{Number(sl.reserved)}</td>
                                                  </tr>
                                                ))}
                                              </tbody>
                                            </table>
                                          )}
                                        </div>

                                        <div>
                                          <strong style={{ fontSize: "0.85rem" }}>
                                            الإصدارات ({d.variants.length})
                                          </strong>
                                          {d.variants.length === 0 ? (
                                            <div
                                              style={{
                                                fontSize: "0.8rem",
                                                color: "var(--text-secondary)",
                                              }}
                                            >
                                              لا توجد إصدارات.
                                            </div>
                                          ) : (
                                            <table
                                              className="ss-table"
                                              style={{ marginTop: "0.4rem", fontSize: "0.8rem" }}
                                            >
                                              <thead>
                                                <tr>
                                                  <th>الاسم</th>
                                                  <th>SKU</th>
                                                  <th>السعر</th>
                                                  <th>الخصائص</th>
                                                  <th>الحالة</th>
                                                </tr>
                                              </thead>
                                              <tbody>
                                                {d.variants.map((v) => (
                                                  <tr key={v.id}>
                                                    <td>{v.name}</td>
                                                    <td
                                                      dir="ltr"
                                                      style={{ fontFamily: "monospace" }}
                                                    >
                                                      {v.skuCode}
                                                    </td>
                                                    <td>{Number(v.price)}</td>
                                                    <td>
                                                      {v.attributes.length === 0
                                                        ? "—"
                                                        : v.attributes.map((a) => (
                                                            <span
                                                              key={a.value.id}
                                                              style={{ marginLeft: "0.3rem" }}
                                                            >
                                                              {a.value.attribute.name}:{" "}
                                                              {a.value.value}
                                                              {a.value.colorHex && (
                                                                <span
                                                                  style={{
                                                                    display: "inline-block",
                                                                    width: 10,
                                                                    height: 10,
                                                                    borderRadius: 3,
                                                                    background: a.value.colorHex,
                                                                    verticalAlign: "middle",
                                                                    marginInlineStart: 4,
                                                                  }}
                                                                />
                                                              )}
                                                            </span>
                                                          ))}
                                                    </td>
                                                    <td>{v.isActive ? "نشط" : "غير نشط"}</td>
                                                  </tr>
                                                ))}
                                              </tbody>
                                            </table>
                                          )}
                                        </div>
                                      </div>
                                    )}
                                  </td>
                                </tr>
                              );
                            })()}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {totalPages > 1 && (
                <div
                  style={{
                    display: "flex",
                    justifyContent: "center",
                    alignItems: "center",
                    gap: "0.5rem",
                    padding: "0.75rem 1rem",
                    borderTop: "1px solid var(--border-color)",
                  }}
                >
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    style={{
                      padding: "0.4rem 0.8rem",
                      border: "1px solid var(--border-color)",
                      borderRadius: 6,
                      background: "var(--bg-primary)",
                      cursor: page <= 1 ? "default" : "pointer",
                      opacity: page <= 1 ? 0.4 : 1,
                      fontSize: "0.8rem",
                    }}
                  >
                    السابق
                  </button>
                  <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                    الصفحة {toArabicNumerals(page)} من {toArabicNumerals(totalPages)}
                  </span>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                    style={{
                      padding: "0.4rem 0.8rem",
                      border: "1px solid var(--border-color)",
                      borderRadius: 6,
                      background: "var(--bg-primary)",
                      cursor: page >= totalPages ? "default" : "pointer",
                      opacity: page >= totalPages ? 0.4 : 1,
                      fontSize: "0.8rem",
                    }}
                  >
                    التالي
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {editingItem && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            direction: "rtl",
          }}
          onClick={closeEdit}
        >
          <div
            style={{
              background: "var(--bg-primary)",
              borderRadius: 14,
              width: "min(90vw, 600px)",
              maxHeight: "90vh",
              overflowY: "auto",
              padding: "1.5rem",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: "0 0 1rem", fontSize: "1.1rem", fontWeight: 700 }}>
              تعديل المنتج — {editingItem.name}
            </h3>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.8rem" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                <label style={{ fontSize: "0.7rem", fontWeight: 700 }}>اسم المنتج *</label>
                <input
                  style={{
                    padding: "0.55rem 0.7rem",
                    border: "1px solid #ccc",
                    borderRadius: 9,
                    fontSize: "0.8rem",
                    fontFamily: "inherit",
                    textAlign: "right",
                  }}
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  disabled={saving}
                />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                <label style={{ fontSize: "0.7rem", fontWeight: 700 }}>رمز SKU *</label>
                <input
                  style={{
                    padding: "0.55rem 0.7rem",
                    border: "1px solid #ccc",
                    borderRadius: 9,
                    fontSize: "0.8rem",
                    fontFamily: "inherit",
                    textAlign: "right",
                  }}
                  value={editSku}
                  onChange={(e) => setEditSku(e.target.value)}
                  disabled={saving}
                />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                <label style={{ fontSize: "0.7rem", fontWeight: 700 }}>الباركود</label>
                <input
                  style={{
                    padding: "0.55rem 0.7rem",
                    border: "1px solid #ccc",
                    borderRadius: 9,
                    fontSize: "0.8rem",
                    fontFamily: "inherit",
                    textAlign: "right",
                  }}
                  value={editBarcode}
                  onChange={(e) => setEditBarcode(e.target.value)}
                  disabled={saving}
                />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                <label style={{ fontSize: "0.7rem", fontWeight: 700 }}>سعر التكلفة *</label>
                <input
                  style={{
                    padding: "0.55rem 0.7rem",
                    border: "1px solid #ccc",
                    borderRadius: 9,
                    fontSize: "0.8rem",
                    fontFamily: "inherit",
                    textAlign: "right",
                  }}
                  type="number"
                  step="0.01"
                  value={editCost}
                  onChange={(e) => setEditCost(e.target.value)}
                  disabled={saving}
                />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                <label style={{ fontSize: "0.7rem", fontWeight: 700 }}>سعر البيع *</label>
                <input
                  style={{
                    padding: "0.55rem 0.7rem",
                    border: "1px solid #ccc",
                    borderRadius: 9,
                    fontSize: "0.8rem",
                    fontFamily: "inherit",
                    textAlign: "right",
                  }}
                  type="number"
                  step="0.01"
                  value={editPrice}
                  onChange={(e) => setEditPrice(e.target.value)}
                  disabled={saving}
                />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                <label style={{ fontSize: "0.7rem", fontWeight: 700 }}>السعر قبل الخصم</label>
                <input
                  style={{
                    padding: "0.55rem 0.7rem",
                    border: "1px solid #ccc",
                    borderRadius: 9,
                    fontSize: "0.8rem",
                    fontFamily: "inherit",
                    textAlign: "right",
                  }}
                  type="number"
                  step="0.01"
                  value={editPriceBefore}
                  onChange={(e) => setEditPriceBefore(e.target.value)}
                  disabled={saving}
                />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                <label style={{ fontSize: "0.7rem", fontWeight: 700 }}>الوزن (كجم)</label>
                <input
                  style={{
                    padding: "0.55rem 0.7rem",
                    border: "1px solid #ccc",
                    borderRadius: 9,
                    fontSize: "0.8rem",
                    fontFamily: "inherit",
                    textAlign: "right",
                  }}
                  type="number"
                  step="0.001"
                  value={editWeight}
                  onChange={(e) => setEditWeight(e.target.value)}
                  disabled={saving}
                />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem", justifyContent: "flex-end" }}>
                <label style={{ fontSize: "0.7rem", fontWeight: 700 }}>
                  <input
                    type="checkbox"
                    checked={editTrackExpiry}
                    onChange={(e) => setEditTrackExpiry(e.target.checked)}
                    disabled={saving}
                    style={{ marginLeft: "0.4rem" }}
                  />
                  تتبع الصلاحية
                </label>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                <label style={{ fontSize: "0.7rem", fontWeight: 700 }}>القسم</label>
                <Select
                  value={editCategoryId}
                  onChange={(v) => setEditCategoryId(String(v ?? ""))}
                  options={[
                    { value: "", label: "غير محدد" },
                    ...categories.map((c) => ({ value: c.id, label: c.name })),
                  ]}
                  disabled={saving}
                />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                <label style={{ fontSize: "0.7rem", fontWeight: 700 }}>الماركة</label>
                <Select
                  value={editBrandId}
                  onChange={(v) => setEditBrandId(String(v ?? ""))}
                  options={[
                    { value: "", label: "غير محدد" },
                    ...brands.map((b) => ({ value: b.id, label: b.name })),
                  ]}
                  disabled={saving}
                />
              </div>
              <div
                style={{
                  gridColumn: "1 / -1",
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.25rem",
                }}
              >
                <label style={{ fontSize: "0.7rem", fontWeight: 700 }}>الوصف</label>
                <input
                  style={{
                    padding: "0.55rem 0.7rem",
                    border: "1px solid #ccc",
                    borderRadius: 9,
                    fontSize: "0.8rem",
                    fontFamily: "inherit",
                    textAlign: "right",
                  }}
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  disabled={saving}
                />
              </div>
              <div
                style={{
                  gridColumn: "1 / -1",
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.4rem",
                }}
              >
                <label style={{ fontSize: "0.7rem", fontWeight: 700 }}>صور المنتج</label>
                {editImageUrls.length > 0 && (
                  <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                    {editImageUrls.map((url, i) => (
                      <div key={i} style={{ position: "relative" }}>
                        <ProductImage
                          src={url}
                          alt={`product-${i + 1}`}
                          size={54}
                          style={{
                            border: "1px solid var(--border-color)",
                          }}
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setEditImageUrls(editImageUrls.filter((_, idx) => idx !== i))
                          }
                          title="إزالة"
                          style={{
                            position: "absolute",
                            top: -6,
                            insetInlineEnd: -6,
                            width: 20,
                            height: 20,
                            borderRadius: "50%",
                            border: "none",
                            background: "var(--color-danger)",
                            color: "var(--color-accent-contrast)",
                            cursor: "pointer",
                            fontSize: "0.7rem",
                            lineHeight: 1,
                          }}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <label
                    className="io-button io-button-ghost"
                    style={{ cursor: uploadingEditImages ? "wait" : "pointer" }}
                  >
                    {uploadingEditImages ? "جاري الرفع..." : "رفع ملفات"}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
                      multiple
                      style={{ display: "none" }}
                      disabled={saving || uploadingEditImages}
                      onChange={async (e) => {
                        const files = Array.from(e.target.files ?? []);
                        e.target.value = "";
                        if (files.length === 0) return;
                        setUploadingEditImages(true);
                        try {
                          const urls: string[] = [];
                          for (const file of files) {
                            const url = await uploadImage(file);
                            if (!url) throw new Error("تعذر رفع الصورة.");
                            urls.push(url);
                          }
                          setEditImageUrls((prev) => [...prev, ...urls]);
                          setNotice({ type: "success", text: "تم رفع الصور بنجاح." });
                        } catch (error) {
                          setNotice({
                            type: "error",
                            text: error instanceof Error ? error.message : "تعذر رفع الصور.",
                          });
                        } finally {
                          setUploadingEditImages(false);
                        }
                      }}
                    />
                  </label>
                </div>
                <small style={{ color: "var(--text-muted)", fontSize: "0.7rem" }}>
                  اختر الصور من جهازك — الحفظ يستبدل معرض الصور بالقائمة المعروضة.
                </small>
              </div>
              <div
                style={{
                  gridColumn: "1 / -1",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                }}
              >
                <input
                  type="checkbox"
                  checked={editIsActive}
                  onChange={(e) => setEditIsActive(e.target.checked)}
                  disabled={saving}
                />
                <label style={{ fontSize: "0.8rem" }}>نشط (متاح للشراء والمبيعات)</label>
              </div>
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: "0.5rem",
                marginTop: "1.25rem",
                paddingTop: "1rem",
                borderTop: "1px solid var(--border-color)",
              }}
            >
              <button
                type="button"
                className="io-button io-button-ghost"
                onClick={closeEdit}
                disabled={saving}
              >
                إلغاء
              </button>
              <button
                type="button"
                className="io-button io-button-primary"
                onClick={saveEdit}
                disabled={saving}
              >
                {saving ? "جاري الحفظ..." : "حفظ التعديل"}
              </button>
            </div>
          </div>
        </div>
      )}
      {showStoreModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            direction: "rtl",
          }}
          onClick={() => setShowStoreModal(false)}
        >
          <div
            style={{
              background: "var(--bg-primary, #fff)",
              borderRadius: 14,
              width: "min(90vw, 520px)",
              maxHeight: "90vh",
              overflowY: "auto",
              padding: "1.5rem",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: "0 0 0.5rem", fontSize: "1.1rem", fontWeight: 700 }}>
              تصدير المنتجات الى المتجر
            </h3>
            <p style={{ margin: "0 0 1rem", fontSize: "0.82rem", color: "var(--text-secondary)" }}>
              اختر المتجر المراد دفع المنتجات المحددة ({grid.selected.size}) إليه.
            </p>
            {stores.length === 0 ? (
              <p style={{ fontSize: "0.85rem" }}>لا توجد متاجر مربوطة بعد.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {stores.map((store) => {
                  // Push is possible only for a Shopify store on a deployment
                  // with the feature on AND with products actually selected.
                  const canPush =
                    store.platform === "SHOPIFY" && shopifyEnabled && grid.selected.size > 0;
                  const busy = pushingStoreId === store.id;
                  return (
                  <div
                    key={store.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      border: "1px solid var(--border-color)",
                      borderRadius: 10,
                      padding: "0.6rem 0.8rem",
                    }}
                  >
                    <div>
                      <strong style={{ fontSize: "0.85rem" }}>{store.name}</strong>
                      <span
                        style={{
                          fontSize: "0.75rem",
                          color: "var(--text-secondary)",
                          marginInlineStart: "0.5rem",
                        }}
                      >
                        {store.platform}
                      </span>
                    </div>
                    <button
                      type="button"
                      className={canPush ? "io-button io-button-primary" : "io-button io-button-ghost"}
                      disabled={!canPush || busy}
                      onClick={() => void exportToStore(store.id)}
                      title={
                        store.platform !== "SHOPIFY"
                          ? "متجر مخصص — لا يوجد نظام خارجي للدفع إليه"
                          : !shopifyEnabled
                            ? "مزامنة Shopify معطّلة على هذا الحساب"
                            : grid.selected.size === 0
                              ? "حدد منتجاً واحداً على الأقل من الجدول"
                              : "إنشاء/تحديث المنتجات المحددة في Shopify"
                      }
                    >
                      {busy
                        ? "جارٍ التصدير..."
                        : store.platform !== "SHOPIFY"
                          ? "دفع المنتجات (غير مدعوم)"
                          : !shopifyEnabled
                            ? "دفع المنتجات (Shopify معطّلة)"
                            : grid.selected.size === 0
                              ? "دفع المنتجات (حدد منتجات)"
                              : "دفع المنتجات"}
                    </button>
                  </div>
                  );
                })}
              </div>
            )}
            {pushResult && (
              <p
                style={{
                  margin: "1rem 0 0",
                  fontSize: "0.78rem",
                  color: "var(--text-primary)",
                  background: "var(--color-accent-soft)",
                  borderRadius: 8,
                  padding: "0.5rem 0.7rem",
                }}
                role="status"
              >
                {pushResult}
              </p>
            )}
            <p
              style={{
                margin: "1rem 0 0",
                fontSize: "0.75rem",
                color: "var(--text-secondary)",
                background: "var(--bg-secondary)",
                borderRadius: 8,
                padding: "0.5rem 0.7rem",
              }}
            >
              {!shopifyEnabled ? (
                <>
                  ⛔ <strong>تصدير المنتجات إلى متجر غير متاح.</strong> مزامنة Shopify معطّلة
                  على هذا الحساب — النسخة المستضافة لا تستقبل إشعارات Shopify. مزامنة الطلبات
                  والمنتجات والمخزون تعمل في النسخة ذاتية الاستضافة، راجع{" "}
                  <a href="https://docs.mawzun.org" target="_blank" rel="noreferrer" style={{ textDecoration: "underline" }}>
                    docs.mawzun.org
                  </a>
                  . المتاجر المخصصة تعمل كالمعتاد.
                </>
              ) : (
                <>
                  ℹ️ يتحقق التصدير من معرّف Shopify المخزَّن للمنتج: ينشئ منتجاً جديداً إن لم
                  يكن موجوداً، ويحدّث المنتج نفسه إن كان مرتبطاً — فلا يتكرر المنتج عند إعادة
                  الدفع. المنتجات بلا رمز SKU تُتخطى، لأن استيراد الطلبات يطابق بالـ SKU.
                </>
              )}
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "1rem" }}>
              <button
                type="button"
                className="io-button io-button-ghost"
                onClick={() => setShowStoreModal(false)}
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
