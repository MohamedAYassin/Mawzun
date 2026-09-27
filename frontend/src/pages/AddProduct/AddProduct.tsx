import { useState, useEffect, useCallback, useRef } from "react";
import DashboardLayout from "../../components/DashboardLayout/DashboardLayout";
import { Select } from "../../components/Select/Select";
import {
  catalogApi,
  inventoryApi,
  type Brand,
  type Category,
  type CreateProductInput,
  type Product,
  type StorageLocation,
  type TaxRate,
  type Warehouse,
} from "../../lib/api";
import "../../styles/DashboardViews.css";
import "./AddProduct.css";
import { toast } from "sonner";
import { ProductImage } from "../../components/ProductImage";
import { useImageUpload } from "../../lib/useImageUpload";

const STORAGE_KEY = "formDraft_addProduct";

interface AddProductProps {
  navigate: (path: string) => void;
}

interface WarehouseLevel {
  /** Set when the point already exists, so saving updates instead of duplicating. */
  id?: string;
  warehouseId: string;
  minStockLevel: number;
  maxStockLevel: number;
}

interface StorageItem {
  storageLocationId: string;
  actualQuantity: number;
}

interface DraftData {
  step: number;
  name: string;
  skuCode: string;
  barcode: string;
  price: string;
  priceBeforeDiscount: string;
  costPrice: string;
  description: string;
  categoryId: string;
  brandId: string;
  salesTaxRateId: string;
  purchaseTaxRateId: string;
  weightKg: string;
  trackExpiry: boolean;
  isActive: boolean;
  warehouses: WarehouseLevel[];
  locations: StorageItem[];
}

function defaultDraft(): DraftData {
  return {
    step: 0,
    name: "",
    skuCode: "",
    barcode: "",
    price: "",
    priceBeforeDiscount: "",
    costPrice: "",
    description: "",
    categoryId: "",
    brandId: "",
    salesTaxRateId: "",
    purchaseTaxRateId: "",
    weightKg: "",
    trackExpiry: false,
    isActive: true,
    warehouses: [],
    locations: [],
  };
}

function loadDraft(): DraftData | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as DraftData;
  } catch {
    /* ignore */
  }
  return null;
}

function persistDraft(data: DraftData) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    /* ignore */
  }
}

function clearDraft() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

const STEPS = ["المعلومات الأساسية", "التصنيف والوصف", "المخازن والأرفف", "الوسائط والمراجعة"];

export default function AddProduct({ navigate }: AddProductProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [categories, setCategories] = useState<Category[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [taxRates, setTaxRates] = useState<TaxRate[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [locations, setLocations] = useState<StorageLocation[]>([]);
  const [editing, setEditing] = useState<Product | null>(null);

  const [draft, setDraft] = useState<DraftData>(defaultDraft);
  const [step, setStep] = useState(0);
  const restoredRef = useRef(false);

  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const { upload: uploadImage } = useImageUpload();

  const editingId = sessionStorage.getItem("editingProductId");

  const warehouseName = (id: string) => warehouses.find((w) => w.id === id)?.name ?? "—";

  const removeImage = (index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  // Uploads picked files straight to R2. The returned asset addresses stay
  // internal to the save payload; the user never has to paste one.
  const uploadPickedFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploadingFiles(true);
    try {
      const urls: string[] = [];
      for (const file of Array.from(files)) {
        const url = await uploadImage(file);
        if (!url) throw new Error("تعذر رفع الصورة.");
        urls.push(url);
      }
      setSelectedFiles((prev) => [...prev, ...urls.filter((u) => !prev.includes(u))]);
      if (urls.length > 0) toast.success('تم رفع الصور بنجاح.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'تعذر رفع الصور.');
    } finally {
      setUploadingFiles(false);
    }
  };

  const updateDraft = useCallback(
    (patch: Partial<DraftData>) => {
      setDraft((prev) => {
        const next = { ...prev, ...patch };
        if (!editingId) persistDraft(next);
        return next;
      });
    },
    [editingId],
  );

  const loadInitialData = useCallback(async () => {
    setLoading(true);
    try {
      const [categoryPage, brandPage, taxRateList, warehouseList, locationList] = await Promise.all(
        [
          catalogApi.listCategories({ pageSize: 200 }),
          catalogApi.listBrands({ pageSize: 200 }),
          catalogApi.listTaxRates(),
          inventoryApi.listWarehouses(),
          inventoryApi.listStorageLocations(),
        ],
      );
      setCategories(categoryPage.items);
      setBrands(brandPage.items);
      setTaxRates(taxRateList);
      setWarehouses(warehouseList);
      setLocations(locationList);

      if (editingId) {
        const [details, reorderPoints] = await Promise.all([
          catalogApi.getProduct(editingId),
          inventoryApi.listReorderPoints({ productId: editingId }),
        ]);
        setEditing(details);
        setSelectedFiles(details.images.map((img) => img.imageUrl));
        setDraft({
          step: 0,
          name: details.name,
          skuCode: details.skuCode ?? "",
          barcode: details.barcode ?? "",
          price: String(details.price),
          priceBeforeDiscount: details.priceBeforeDiscount ?? "",
          costPrice: String(details.costPrice),
          description: details.description ?? "",
          categoryId: details.category?.id ?? "",
          brandId: details.brand?.id ?? "",
          salesTaxRateId: details.salesTaxRate?.id ?? "",
          purchaseTaxRateId: details.purchaseTaxRate?.id ?? "",
          weightKg: details.weightKg != null ? String(details.weightKg) : "",
          trackExpiry: details.trackExpiry ?? false,
          isActive: details.isActive,
          warehouses: reorderPoints.map((point) => ({
            id: point.id,
            warehouseId: point.warehouse.id,
            minStockLevel: point.minStockLevel,
            maxStockLevel: point.maxStockLevel,
          })),
          locations: [],
        });
      } else {
        const saved = loadDraft();
        if (saved && !restoredRef.current) {
          restoredRef.current = true;
          setDraft(saved);
          setStep(saved.step);
        }
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [editingId]);

  useEffect(() => {
    void loadInitialData();
  }, [loadInitialData]);

  const goToStep = (newStep: number) => {
    setStep(newStep);
    updateDraft({ step: newStep });
  };

  const canProceed = (): boolean => {
    if (step === 0) {
      return (
        draft.name.trim().length > 0 &&
        draft.skuCode.trim().length > 0 &&
        draft.price.length > 0 &&
        draft.costPrice.length > 0
      );
    }
    return true;
  };

  const handleWarehouseAdd = () => {
    if (warehouses.length === 0) return;
    const first = warehouses[0];
    if (!first) return;
    updateDraft({
      warehouses: [
        ...draft.warehouses,
        { warehouseId: first.id, minStockLevel: 0, maxStockLevel: 0 },
      ],
    });
  };

  const handleWarehouseRemove = (index: number) => {
    updateDraft({ warehouses: draft.warehouses.filter((_, i) => i !== index) });
  };

  const handleWarehouseSelect = (index: number, warehouseId: string) => {
    const updated = [...draft.warehouses];
    const current = updated[index];
    if (!current) return;
    updated[index] = { ...current, warehouseId };
    updateDraft({ warehouses: updated });
  };

  const handleWarehouseLevel = (
    index: number,
    key: "minStockLevel" | "maxStockLevel",
    value: number,
  ) => {
    const updated = [...draft.warehouses];
    const current = updated[index];
    if (!current) return;
    updated[index] = { ...current, [key]: value };
    updateDraft({ warehouses: updated });
  };

  const handleLocationAdd = () => {
    const first = locations[0];
    if (!first) return;
    updateDraft({
      locations: [...draft.locations, { storageLocationId: first.id, actualQuantity: 0 }],
    });
  };

  const handleLocationRemove = (index: number) => {
    updateDraft({ locations: draft.locations.filter((_, i) => i !== index) });
  };

  const handleLocationSelect = (index: number, storageLocationId: string) => {
    const updated = [...draft.locations];
    const current = updated[index];
    if (!current) return;
    updated[index] = { ...current, storageLocationId };
    updateDraft({ locations: updated });
  };

  const handleLocationQuantity = (index: number, value: number) => {
    const updated = [...draft.locations];
    const current = updated[index];
    if (!current) return;
    updated[index] = { ...current, actualQuantity: value };
    updateDraft({ locations: updated });
  };

  const submit = async () => {
    const cleanName = draft.name.trim();
    const cleanSku = draft.skuCode.trim();
    if (!cleanName || !cleanSku || !draft.price || !draft.costPrice) {
      alert("يرجى إدخال الحقول المطلوبة: الاسم، كود SKU، السعر، وسعر التكلفة.");
      return;
    }

    setSaving(true);
    try {
      const payload: CreateProductInput = {
        name: cleanName,
        skuCode: cleanSku,
        barcode: draft.barcode.trim() || null,
        description: draft.description.trim() || null,
        categoryId: draft.categoryId || null,
        brandId: draft.brandId || null,
        salesTaxRateId: draft.salesTaxRateId || null,
        purchaseTaxRateId: draft.purchaseTaxRateId || null,
        price: Number(draft.price),
        priceBeforeDiscount: draft.priceBeforeDiscount ? Number(draft.priceBeforeDiscount) : null,
        costPrice: Number(draft.costPrice),
        weightKg: draft.weightKg.trim() === "" ? null : Number(draft.weightKg),
        trackExpiry: draft.trackExpiry,
        isActive: draft.isActive,
        images: selectedFiles.map((imageUrl, index) => ({ imageUrl, isPrimary: index === 0 })),
      };

      const saved = editing
        ? await catalogApi.updateProduct(editing.id, payload)
        : await catalogApi.createProduct(payload);

      // Opening stock. The product payload has nowhere to put a quantity: the
      // ledger owns levels, so a counted adjustment is the only way to set one.
      // adjustStock takes the quantity the shelf should hold, which is exactly
      // what an opening balance is. Skipped when editing, because stock is
      // then changed by movements, not by this form.
      if (!editing) {
        for (const location of draft.locations) {
          if (!location.storageLocationId || location.actualQuantity <= 0) continue;
          await inventoryApi.adjustStock({
            productId: saved.id,
            storageLocationId: location.storageLocationId,
            countedQuantity: location.actualQuantity,
            reason: "رصيد افتتاحي",
          });
        }
      }

      // Reorder points are their own resource, keyed by product and warehouse:
      // rows that already exist are updated, new ones created.
      for (const level of draft.warehouses) {
        if (!level.warehouseId) continue;
        const levels = { minStockLevel: level.minStockLevel, maxStockLevel: level.maxStockLevel };
        if (level.id) {
          await inventoryApi.updateReorderPoint(level.id, levels);
        } else {
          await inventoryApi.createReorderPoint({
            productId: saved.id,
            warehouseId: level.warehouseId,
            ...levels,
          });
        }
      }

      sessionStorage.removeItem("editingProductId");
      clearDraft();
      navigate("/dashboard/products");
    } catch (err) {
      alert(err instanceof Error ? err.message : "تعذر حفظ بيانات المنتج.");
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    sessionStorage.removeItem("editingProductId");
    clearDraft();
    navigate("/dashboard/products");
  };

  if (loading) {
    return (
      <DashboardLayout navigate={navigate}>
        <div className="view-container">
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              minHeight: 300,
              color: "var(--text-primary)",
            }}
          >
            جاري التحميل...
          </div>
        </div>
      </DashboardLayout>
    );
  }

  const categoryOptions = [
    { value: "", label: "بدون قسم" },
    ...categories.map((c) => ({ value: c.id, label: c.name })),
  ];
  const brandOptions = [
    { value: "", label: "بدون ماركة" },
    ...brands.map((b) => ({ value: b.id, label: b.name })),
  ];
  const taxRateOptions = [
    { value: "", label: "بدون ضريبة" },
    ...taxRates.map((r) => ({
      value: r.id,
      label: `${r.name} (${Number(r.percentage)}%)`,
    })),
  ];

  return (
    <DashboardLayout navigate={navigate}>
      <div className="view-container">
        <div className="view-header" style={{ marginBottom: "1.5rem" }}>
          <div>
            <h1 className="view-header-title">{editing ? "تعديل المنتج" : "إضافة منتج"}</h1>
            <p className="view-header-subtitle">
              {editing ? "تعديل بيانات منتج حالي." : "إضافة منتج جديد إلى دليل المنتجات."}
            </p>
          </div>
        </div>

        <div className="ap-step-indicator">
          {STEPS.map((label, i) => (
            <div
              key={i}
              className={`ap-step-item ${i === step ? "ap-step-active" : ""} ${
                i < step ? "ap-step-done" : ""
              }`}
              onClick={() => (i < step ? goToStep(i) : undefined)}
            >
              <div className="ap-step-circle">{i < step ? "✓" : i + 1}</div>
              <div className="ap-step-label">{label}</div>
            </div>
          ))}
        </div>

        <form
          className="io-multi-editor"
          style={{ background: "var(--bg-secondary)", padding: "1rem", borderRadius: "12px" }}
          onSubmit={(e) => e.preventDefault()}
        >
          {step === 0 && (
            <>
              <div className="io-multi-editor-full">
                <h3>المعلومات الأساسية</h3>
                <p style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
                  أدخل الاسم ورموز التعريف والتسعير الأساسي.
                </p>
              </div>

              <div className="io-editor-field">
                <label>اسم المنتج *</label>
                <input
                  className="pb-input"
                  value={draft.name}
                  onChange={(e) => updateDraft({ name: e.target.value })}
                  placeholder="مثال: تيشرت قطني أسود"
                  disabled={saving}
                />
              </div>

              <div className="io-editor-field">
                <label>رمز SKU *</label>
                <input
                  className="pb-input"
                  value={draft.skuCode}
                  onChange={(e) => updateDraft({ skuCode: e.target.value })}
                  placeholder="مثال: TSH-BLK-M"
                  disabled={saving}
                />
              </div>

              <div className="io-editor-field">
                <label>الباركود (Barcode)</label>
                <input
                  className="pb-input"
                  value={draft.barcode}
                  onChange={(e) => updateDraft({ barcode: e.target.value })}
                  placeholder="مثال: 6221234567890"
                  disabled={saving}
                />
              </div>

              <div className="io-editor-field">
                <label>سعر التكلفة الأساسي *</label>
                <input
                  type="number"
                  step="0.01"
                  className="pb-input"
                  value={draft.costPrice}
                  onChange={(e) => updateDraft({ costPrice: e.target.value })}
                  placeholder="0.00"
                  disabled={saving}
                />
              </div>

              <div className="io-editor-field">
                <label>سعر البيع *</label>
                <input
                  type="number"
                  step="0.01"
                  className="pb-input"
                  value={draft.price}
                  onChange={(e) => updateDraft({ price: e.target.value })}
                  placeholder="0.00"
                  disabled={saving}
                />
              </div>

              <div className="io-editor-field">
                <label>السعر قبل الخصم (اختياري)</label>
                <input
                  type="number"
                  step="0.01"
                  className="pb-input"
                  value={draft.priceBeforeDiscount}
                  onChange={(e) => updateDraft({ priceBeforeDiscount: e.target.value })}
                  placeholder="0.00"
                  disabled={saving}
                />
              </div>

              <div className="io-editor-field">
                <label>الوزن (كجم - اختياري)</label>
                <input
                  type="number"
                  step="0.001"
                  className="pb-input"
                  value={draft.weightKg}
                  onChange={(e) => updateDraft({ weightKg: e.target.value })}
                  placeholder="0.000"
                  disabled={saving}
                />
              </div>

              <div className="io-editor-field">
                <label className="ss-checkbox-label">
                  <input
                    type="checkbox"
                    checked={draft.trackExpiry}
                    onChange={(e) => updateDraft({ trackExpiry: e.target.checked })}
                    disabled={saving}
                  />
                  <span>تتبع تاريخ الصلاحية</span>
                </label>
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <div className="io-multi-editor-full">
                <h3>التصنيف والوصف</h3>
                <p style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
                  حدد القسم والعلامة التجارية والضرائب.
                </p>
              </div>

              <div className="io-editor-field">
                <label>القسم</label>
                <Select
                  value={draft.categoryId}
                  onChange={(v) => updateDraft({ categoryId: String(v ?? "") })}
                  options={categoryOptions}
                  disabled={saving}
                />
              </div>

              <div className="io-editor-field">
                <label>الماركة / العلامة</label>
                <Select
                  value={draft.brandId}
                  onChange={(v) => updateDraft({ brandId: String(v ?? "") })}
                  options={brandOptions}
                  disabled={saving}
                />
              </div>

              <div className="io-editor-field">
                <label>ضريبة المبيعات</label>
                <Select
                  value={draft.salesTaxRateId}
                  onChange={(v) => updateDraft({ salesTaxRateId: String(v ?? "") })}
                  options={taxRateOptions}
                  disabled={saving}
                />
              </div>

              <div className="io-editor-field">
                <label>ضريبة المشتريات</label>
                <Select
                  value={draft.purchaseTaxRateId}
                  onChange={(v) => updateDraft({ purchaseTaxRateId: String(v ?? "") })}
                  options={taxRateOptions}
                  disabled={saving}
                />
              </div>

              <div className="io-editor-field io-multi-editor-full">
                <label>الوصف</label>
                <input
                  className="pb-input"
                  value={draft.description}
                  onChange={(e) => updateDraft({ description: e.target.value })}
                  placeholder="شرح مبسط للمنتج ومواصفاته"
                  disabled={saving}
                />
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <div className="io-multi-editor-full">
                <h3>المخازن والأرفف</h3>
                <p style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
                  حدد الحدود التنبيهية لكل مستودع واربط أماكن التخزين الأولية.
                </p>
              </div>

              <div className="io-multi-editor-full io-nested-form-section">
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: "0.5rem",
                  }}
                >
                  <strong>الحدود التنبيهية للمخازن</strong>
                  <button
                    type="button"
                    className="io-button io-button-secondary"
                    onClick={handleWarehouseAdd}
                    disabled={saving || warehouses.length === 0}
                  >
                    + إضافة حد مستودع
                  </button>
                </div>
                {draft.warehouses.length === 0 && (
                  <p style={{ color: "var(--text-primary)", fontSize: "0.85rem" }}>
                    لم تُضف أي حدود للمستودعات بعد.
                  </p>
                )}
                {draft.warehouses.map((w, idx) => (
                  <div className="io-nested-row" key={idx}>
                    <div>
                      <label>المخزن</label>
                      <Select
                        value={w.warehouseId}
                        onChange={(v) => handleWarehouseSelect(idx, String(v ?? ""))}
                        options={warehouses.map((wh) => ({ value: wh.id, label: wh.name }))}
                        disabled={saving}
                      />
                    </div>
                    <div>
                      <label>الحد الأدنى</label>
                      <input
                        type="number"
                        className="pb-input"
                        value={w.minStockLevel}
                        onChange={(e) =>
                          handleWarehouseLevel(idx, "minStockLevel", Number(e.target.value))
                        }
                        placeholder="الحد الأدنى"
                        disabled={saving}
                      />
                    </div>
                    <div>
                      <label>الحد الأقصى</label>
                      <input
                        type="number"
                        className="pb-input"
                        value={w.maxStockLevel}
                        onChange={(e) =>
                          handleWarehouseLevel(idx, "maxStockLevel", Number(e.target.value))
                        }
                        placeholder="الحد الأقصى"
                        disabled={saving}
                      />
                    </div>
                    <div className="io-nested-row-btn">
                      <button
                        type="button"
                        className="io-button io-button-danger"
                        onClick={() => handleWarehouseRemove(idx)}
                        disabled={saving}
                      >
                        حذف
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="io-multi-editor-full io-nested-form-section">
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: "0.5rem",
                  }}
                >
                  <strong>أماكن التخزين</strong>
                  <button
                    type="button"
                    className="io-button io-button-secondary"
                    onClick={handleLocationAdd}
                    disabled={saving || locations.length === 0}
                  >
                    + إضافة ربط رف
                  </button>
                </div>
                {editing && (
                  <p
                    style={{
                      fontSize: "0.8rem",
                      color: "var(--text-primary)",
                      marginTop: 0,
                      marginBottom: "0.5rem",
                    }}
                  >
                    الكميات الابتدائية تُسجّل عند الإنشاء فقط. بعد ذلك يتغير المخزون عبر الحركات.
                  </p>
                )}
                {draft.locations.length === 0 && (
                  <p style={{ color: "var(--text-primary)", fontSize: "0.85rem" }}>
                    لم تُضف أي أماكن تخزين بعد.
                  </p>
                )}
                {draft.locations.map((sl, idx) => (
                  <div className="io-nested-row" key={idx}>
                    <div>
                      <label>الرف / موقع التخزين</label>
                      <Select
                        value={sl.storageLocationId}
                        onChange={(v) => handleLocationSelect(idx, String(v ?? ""))}
                        options={locations.map((loc) => ({
                          value: loc.id,
                          label: `${loc.name} (${warehouseName(loc.warehouseId)})`,
                        }))}
                        disabled={saving}
                      />
                    </div>
                    <div>
                      <label>
                        الكمية البدئية{" "}
                        <span style={{ fontWeight: 400 }}>(تطبق فقط عند الإنشاء)</span>
                      </label>
                      <input
                        type="number"
                        className="pb-input"
                        value={sl.actualQuantity}
                        onChange={(e) => handleLocationQuantity(idx, Number(e.target.value))}
                        placeholder="الكمية البدئية"
                        disabled={saving || !!editing}
                      />
                    </div>
                    <div className="io-nested-row-btn">
                      <button
                        type="button"
                        className="io-button io-button-danger"
                        onClick={() => handleLocationRemove(idx)}
                        disabled={saving}
                      >
                        حذف
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <div className="io-multi-editor-full">
                <h3>الوسائط والمراجعة</h3>
                <p style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
                  أضف صور المنتج، حدد الحالة، وراجع البيانات قبل الحفظ.
                </p>
              </div>

              <div className="io-editor-field io-multi-editor-full">
                <label>صور المنتج</label>
                <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
                  <label
                    className="io-button"
                    style={{ cursor: uploadingFiles ? "wait" : "pointer", alignSelf: "center" }}
                  >
                    {uploadingFiles ? "جاري الرفع..." : "رفع ملفات"}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
                      multiple
                      style={{ display: "none" }}
                      disabled={saving || uploadingFiles}
                      onChange={(e) => {
                        void uploadPickedFiles(e.target.files);
                        e.target.value = "";
                      }}
                    />
                  </label>
                  <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                    اختر صورة أو أكثر من جهازك
                  </span>
                </div>
                {selectedFiles.length > 0 && (
                  <div
                    style={{
                      display: "flex",
                      gap: "0.5rem",
                      flexWrap: "wrap",
                      marginTop: "0.6rem",
                    }}
                  >
                    {selectedFiles.map((url, i) => (
                      <div key={i} style={{ position: "relative" }}>
                        <ProductImage
                          src={url}
                          alt={`product-${i + 1}`}
                          size={64}
                        />
                        <button
                          type="button"
                          onClick={() => removeImage(i)}
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
                    <button
                      type="button"
                      className="io-button io-button-ghost"
                      onClick={() => setSelectedFiles([])}
                    >
                      إزالة الكل
                    </button>
                  </div>
                )}
                <small style={{ color: "var(--text-muted)", fontSize: "0.72rem" }}>
                  اختر الصور من جهازك — يتم رفعها تلقائياً إلى التخزين.
                </small>
              </div>

              <div className="io-editor-field io-multi-editor-full">
                <label
                  className="io-checkbox-label"
                  style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}
                >
                  <input
                    type="checkbox"
                    checked={draft.isActive}
                    onChange={(e) => updateDraft({ isActive: e.target.checked })}
                    disabled={saving}
                  />
                  <span>نشط (متاح للشراء والمبيعات)</span>
                </label>
              </div>

              <div className="io-multi-editor-full ap-review-grid">
                <div className="ap-review-section">
                  <h4>المعلومات الأساسية</h4>
                  <div>
                    <span>الاسم:</span> {draft.name || "—"}
                  </div>
                  <div>
                    <span>SKU:</span> {draft.skuCode || "—"}
                  </div>
                  <div>
                    <span>الباركود:</span> {draft.barcode || "—"}
                  </div>
                  <div>
                    <span>سعر التكلفة:</span> {draft.costPrice || "—"}
                  </div>
                  <div>
                    <span>سعر البيع:</span> {draft.price || "—"}
                  </div>
                  {draft.priceBeforeDiscount && (
                    <div>
                      <span>السعر قبل الخصم:</span> {draft.priceBeforeDiscount}
                    </div>
                  )}
                </div>
                <div className="ap-review-section">
                  <h4>التصنيف والوصف</h4>
                  <div>
                    <span>القسم:</span>{" "}
                    {categories.find((c) => c.id === draft.categoryId)?.name || "—"}
                  </div>
                  <div>
                    <span>الماركة:</span> {brands.find((b) => b.id === draft.brandId)?.name || "—"}
                  </div>
                  <div>
                    <span>ضريبة المبيعات:</span>{" "}
                    {taxRates.find((r) => r.id === draft.salesTaxRateId)?.name || "—"}
                  </div>
                  <div>
                    <span>ضريبة المشتريات:</span>{" "}
                    {taxRates.find((r) => r.id === draft.purchaseTaxRateId)?.name || "—"}
                  </div>
                  <div>
                    <span>الوصف:</span> {draft.description || "—"}
                  </div>
                </div>
                <div className="ap-review-section">
                  <h4>المخازن والأرفف</h4>
                  {draft.warehouses.length === 0 && draft.locations.length === 0 ? (
                    <p style={{ color: "var(--text-primary)" }}>لا توجد بيانات.</p>
                  ) : (
                    <>
                      {draft.warehouses.length > 0 && (
                        <div style={{ marginBottom: "0.5rem" }}>
                          <strong>الحدود التنبيهية:</strong>
                          <ul
                            style={{
                              margin: "0.25rem 0",
                              paddingRight: "1.1rem",
                              fontSize: "0.85rem",
                            }}
                          >
                            {draft.warehouses.map((w, i) => (
                              <li key={i}>
                                {warehouseName(w.warehouseId)}: الحد الأدنى {w.minStockLevel} / الحد
                                الأقصى {w.maxStockLevel}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {draft.locations.length > 0 && (
                        <div>
                          <strong>أماكن التخزين:</strong>
                          <ul
                            style={{
                              margin: "0.25rem 0",
                              paddingRight: "1.1rem",
                              fontSize: "0.85rem",
                            }}
                          >
                            {draft.locations.map((sl, i) => (
                              <li key={i}>
                                {locations.find((loc) => loc.id === sl.storageLocationId)?.name ||
                                  "—"}
                                : {sl.actualQuantity} وحدة
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </>
                  )}
                </div>
                <div className="ap-review-section">
                  <h4>الوسائط والحالة</h4>
                  <div>
                    <span>الصور:</span>{" "}
                    {selectedFiles.length > 0 ? `${selectedFiles.length} ملفات` : "لا توجد"}
                  </div>
                  <div>
                    <span>الحالة:</span> {draft.isActive ? "نشط" : "غير نشط"}
                  </div>
                </div>
              </div>
            </>
          )}

          <div className="io-multi-editor-full ap-nav-buttons">
            {step > 0 && (
              <button
                type="button"
                className="io-button io-button-ghost"
                onClick={() => goToStep(step - 1)}
                disabled={saving}
              >
                السابق
              </button>
            )}
            {step < STEPS.length - 1 ? (
              <button
                type="button"
                className="io-button io-button-primary"
                onClick={() => goToStep(step + 1)}
                disabled={!canProceed() || saving}
              >
                التالي
              </button>
            ) : (
              <div style={{ display: "flex", gap: "0.5rem", marginRight: "auto" }}>
                <button
                  type="button"
                  className="io-button io-button-ghost"
                  onClick={handleCancel}
                  disabled={saving}
                >
                  إلغاء
                </button>
                <button
                  type="button"
                  className="io-button io-button-primary"
                  onClick={submit}
                  disabled={saving}
                >
                  {saving ? "جاري الحفظ..." : editing ? "حفظ التعديل" : "إضافة المنتج"}
                </button>
              </div>
            )}
          </div>
        </form>
      </div>
    </DashboardLayout>
  );
}
