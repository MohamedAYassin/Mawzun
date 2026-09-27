import { Fragment, useCallback, useEffect, useState, type FormEvent } from "react";
import DashboardLayout from "../../components/DashboardLayout/DashboardLayout";
import { reportsApi, shippingApi, type Carrier, type CitySuccessRate } from "../../lib/api";
import { toArabicNumerals } from "../../utils/arabicNumerals";
import "../SystemSettings/SystemSettings.css";
import { ActiveBadge } from "../shared/ManagementUi";

interface ShippingCompaniesManagementProps {
  navigate: (path: string) => void;
  embedded?: boolean;
}

function Icon({ children, size = 18 }: { children: React.ReactNode; size?: number }) {
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

const PlusIcon = () => (
  <Icon>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);
const RefreshIcon = () => (
  <Icon>
    <path d="M20 11a8.1 8.1 0 0 0-14.8-4L3 10" />
    <path d="M3 5v5h5" />
    <path d="M4 13a8.1 8.1 0 0 0 14.8 4L21 14" />
    <path d="M21 19v-5h-5" />
  </Icon>
);
const SearchIcon = () => (
  <Icon size={16}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4 4" />
  </Icon>
);
const EditIcon = () => (
  <Icon size={16}>
    <path d="m4 16-.7 4.7L8 20l10.7-10.7a2.1 2.1 0 0 0-3-3L5 17" />
    <path d="m14.5 7.5 2 2" />
  </Icon>
);
const TrashIcon = () => (
  <Icon size={16}>
    <path d="M4 7h16M10 11v5M14 11v5M6 7l1 13h10l1-13M9 7V4h6v3" />
  </Icon>
);
const CheckIcon = () => (
  <Icon size={16}>
    <path d="m5 12 4 4L19 6" />
  </Icon>
);
const AlertIcon = () => (
  <Icon size={16}>
    <path d="M12 9v4M12 17h.01" />
    <path d="M10.3 4.4 2.6 18a1.4 1.4 0 0 0 1.2 2h16.4a1.4 1.4 0 0 0 1.2-2L13.7 4.4a2 2 0 0 0-3.4 0Z" />
  </Icon>
);
const TruckIcon = () => (
  <Icon>
    <path d="M3 6h11v10H3zM14 10h4l3 3v3h-7z" />
    <circle cx="7" cy="18" r="2" />
    <circle cx="18" cy="18" r="2" />
  </Icon>
);

type Notice = { type: "success" | "error"; text: string };

const pageSize = 10;

export default function ShippingCompaniesManagement({
  navigate,
  embedded = false,
}: ShippingCompaniesManagementProps) {
  const [all, setAll] = useState<Carrier[]>([]);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [cityRates, setCityRates] = useState<Record<string, CitySuccessRate[]>>({});
  const [citiesLoading, setCitiesLoading] = useState(false);

  // Form state
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Carrier | null>(null);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [carrierType, setCarrierType] = useState<"MANUAL" | "INTEGRATED">("MANUAL");
  const [isActive, setIsActive] = useState(true);
  const [trackingUrlTemplate, setTrackingUrlTemplate] = useState("");
  const [defaultShippingCost, setDefaultShippingCost] = useState("");
  const [defaultCustomerShippingCost, setDefaultCustomerShippingCost] = useState("");
  const [returnShippingCost, setReturnShippingCost] = useState("");
  const [autoSendOrderEnabled, setAutoSendOrderEnabled] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const result = await shippingApi.listCarriers({ pageSize: 200 });
      setAll(result.items);
    } catch (error) {
      setNotice({
        type: "error",
        text: error instanceof Error ? error.message : "تعذر تحميل البيانات.",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const filtered = all.filter((item) => {
    const q = search.trim().toLowerCase();
    return !q || item.name.toLowerCase().includes(q) || (item.code || "").toLowerCase().includes(q);
  });
  const totalEntries = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalEntries / pageSize));
  const items = filtered.slice((page - 1) * pageSize, page * pageSize);

  const resetForm = (item?: Carrier | null) => {
    setName(item?.name ?? "");
    setCode(item?.code ?? "");
    setCarrierType(item?.type ?? "MANUAL");
    setIsActive(item?.isActive ?? true);
    setTrackingUrlTemplate(item?.trackingUrlTemplate ?? "");
    setDefaultShippingCost(item ? String(item.defaultShippingCost) : "");
    setDefaultCustomerShippingCost(item ? String(item.defaultCustomerShippingCost) : "");
    setReturnShippingCost(item ? String(item.returnShippingCost) : "");
    setAutoSendOrderEnabled(item?.autoSendOrderEnabled ?? false);
  };
  const startAdd = () => {
    setEditing(null);
    resetForm(null);
    setFormOpen(true);
  };

  const startEdit = (item: Carrier) => {
    setEditing(item);
    resetForm(item);
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditing(null);
    resetForm(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const cleanName = name.trim();
    if (!cleanName) {
      setNotice({ type: "error", text: "يرجى إدخال اسم شركة الشحن." });
      return;
    }

    const cleanCode = code.trim();
    if (!cleanCode && !editing) {
      setNotice({ type: "error", text: "يرجى إدخال كود شركة الشحن." });
      return;
    }
    const numOr = (v: string, fallback: number) => {
      const n = Number(v);
      return v.trim() === "" || Number.isNaN(n) ? fallback : n;
    };
    setSaving(true);
    setNotice(null);
    try {
      const payload = {
        name: cleanName,
        type: carrierType,
        isActive,
        logoUrl: null,
        trackingUrlTemplate: trackingUrlTemplate.trim() || null,
        defaultShippingCost: numOr(defaultShippingCost, 0),
        defaultCustomerShippingCost: numOr(defaultCustomerShippingCost, 0),
        returnShippingCost: numOr(returnShippingCost, 0),
        autoSendOrderEnabled,
      };
      if (editing) {
        await shippingApi.updateCarrier(editing.id, payload);
        setNotice({ type: "success", text: "تم تحديث شركة الشحن بنجاح." });
      } else {
        // `code` is required by the backend; derive a stable one when left blank.
        const finalCode =
          cleanCode || "CAR-" + Math.abs(hashCode(cleanName)).toString(36).toUpperCase();
        await shippingApi.createCarrier({ ...payload, code: finalCode });
        setNotice({ type: "success", text: "تمت إضافة شركة الشحن بنجاح." });
      }
      closeForm();
      await loadData();
    } catch (error) {
      setNotice({
        type: "error",
        text: error instanceof Error ? error.message : "تعذر حفظ البيانات.",
      });
    } finally {
      setSaving(false);
    }
  };

  const toggleCities = async (item: Carrier) => {
    if (expandedId === item.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(item.id);
    if (cityRates[item.id]) return;
    setCitiesLoading(true);
    try {
      const result = await reportsApi.carrierCitySuccessRate(item.id);
      setCityRates((prev) => ({ ...prev, [item.id]: result.cities }));
    } catch (error) {
      setNotice({
        type: "error",
        text: error instanceof Error ? error.message : "تعذر تحميل نسب نجاح المدن.",
      });
    } finally {
      setCitiesLoading(false);
    }
  };

  const remove = async (item: Carrier) => {
    if (!window.confirm(`هل أنت متأكد من حذف شركة الشحن «${item.name}»؟`)) return;
    setSaving(true);
    setNotice(null);
    try {
      await shippingApi.deleteCarrier(item.id);
      setNotice({ type: "success", text: "تم حذف شركة الشحن بنجاح." });
      if (editing?.id === item.id) closeForm();
      await loadData();
    } catch (error) {
      setNotice({
        type: "error",
        text: error instanceof Error ? error.message : "تعذر حذف البيانات.",
      });
    } finally {
      setSaving(false);
    }
  };

  const content = (
    <div className="view-container">
      <section className="ss-module animate-fade-in">
        <div className="ss-module-heading">
          <div className="ss-module-icon">
            <TruckIcon />
          </div>
          <div>
            <p className="ss-eyebrow">بيانات مرجعية</p>
            <h2>شركات الشحن</h2>
            <p>شركات التوصيل المستخدمة لتنفيذ الطلبات.</p>
          </div>
        </div>

        <div className="ss-module-actions">
          <span className="ss-count-chip">
            <strong>{toArabicNumerals(totalEntries)}</strong> شركة شحن
          </span>
          <button
            className="ss-button ss-button-ghost"
            onClick={() => void loadData()}
            disabled={loading || saving}
          >
            <RefreshIcon /> تحديث
          </button>
          <button className="ss-button ss-button-primary" onClick={startAdd} disabled={saving}>
            <PlusIcon /> إضافة شركة شحن
          </button>
        </div>

        {notice && (
          <div
            className={`ss-status ss-status-${notice.type}`}
            role={notice.type === "error" ? "alert" : "status"}
          >
            <span className="ss-status-icon">
              {notice.type === "success" ? <CheckIcon /> : <AlertIcon />}
            </span>
            <span>{notice.text}</span>
          </div>
        )}

        <div className="ss-list-toolbar">
          <label className="ss-search">
            <SearchIcon />
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="ابحث في شركات الشحن..."
              aria-label="البحث في شركات الشحن"
            />
          </label>
        </div>

        {formOpen && (
          <form className="ss-editor" onSubmit={submit}>
            <div className="ss-editor-copy">
              <span className="ss-editor-kicker">{editing ? "تعديل السجل" : "سجل جديد"}</span>
              <h3>{editing ? "تعديل شركة الشحن" : "إضافة شركة شحن"}</h3>
              <p>استخدم اسماً واضحاً ليسهل اختياره داخل نماذج الطلبات.</p>
            </div>
            <div className="ss-editor-field">
              <label htmlFor="shipping-company-name">الاسم</label>
              <input
                id="shipping-company-name"
                className="ss-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="مثال: أرامكس"
                autoFocus
                disabled={saving}
              />
            </div>
            <div className="ss-editor-field">
              <label htmlFor="shipping-company-code">الكود</label>
              <input
                id="shipping-company-code"
                className="ss-input"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder={
                  editing ? "ثابت بعد الإنشاء" : "مثال: ARAMEX (يُشتق تلقائيًا عند تركه فارغًا)"
                }
                disabled={saving || !!editing}
                dir="ltr"
              />
            </div>
            <div className="ss-editor-field">
              <label htmlFor="shipping-company-type">النوع</label>
              <select
                id="shipping-company-type"
                className="ss-input"
                value={carrierType}
                onChange={(e) => setCarrierType(e.target.value as "MANUAL" | "INTEGRATED")}
                disabled={saving}
              >
                <option value="MANUAL">يدوية</option>
                <option value="INTEGRATED">مدمجة</option>
              </select>
            </div>
            <div className="ss-editor-field">
              <label htmlFor="shipping-company-tracking">قالب رابط التتبع</label>
              <input
                id="shipping-company-tracking"
                className="ss-input"
                value={trackingUrlTemplate}
                onChange={(e) => setTrackingUrlTemplate(e.target.value)}
                placeholder="https://…?tn={trackingNumber}"
                disabled={saving}
                dir="ltr"
              />
            </div>
            <div className="ss-editor-field">
              <label htmlFor="shipping-company-cost">تكلفة الشحن الافتراضية (ج.م)</label>
              <input
                id="shipping-company-cost"
                className="ss-input"
                type="number"
                min="0"
                step="0.01"
                value={defaultShippingCost}
                onChange={(e) => setDefaultShippingCost(e.target.value)}
                disabled={saving}
                dir="ltr"
              />
            </div>
            <div className="ss-editor-field">
              <label htmlFor="shipping-company-cust-cost">تكلفة الشحن على العميل (ج.م)</label>
              <input
                id="shipping-company-cust-cost"
                className="ss-input"
                type="number"
                min="0"
                step="0.01"
                value={defaultCustomerShippingCost}
                onChange={(e) => setDefaultCustomerShippingCost(e.target.value)}
                disabled={saving}
                dir="ltr"
              />
            </div>
            <div className="ss-editor-field">
              <label htmlFor="shipping-company-ret-cost">تكلفة الإرجاع (ج.م)</label>
              <input
                id="shipping-company-ret-cost"
                className="ss-input"
                type="number"
                min="0"
                step="0.01"
                value={returnShippingCost}
                onChange={(e) => setReturnShippingCost(e.target.value)}
                disabled={saving}
                dir="ltr"
              />
            </div>
            <label className="ss-checkbox-label">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                disabled={saving}
              />
              <span>نشطة</span>
            </label>
            <label className="ss-checkbox-label">
              <input
                type="checkbox"
                checked={autoSendOrderEnabled}
                onChange={(e) => setAutoSendOrderEnabled(e.target.checked)}
                disabled={saving}
              />
              <span>إرسال الطلبات تلقائيًا</span>
            </label>
            <div className="ss-editor-actions">
              <button
                className="ss-button ss-button-ghost"
                type="button"
                onClick={closeForm}
                disabled={saving}
              >
                إلغاء
              </button>
              <button className="ss-button ss-button-primary" type="submit" disabled={saving}>
                {saving ? "جاري الحفظ..." : editing ? "حفظ التعديل" : "إضافة السجل"}
              </button>
            </div>
          </form>
        )}

        <div className="ss-data-surface">
          {loading ? (
            <div className="ss-loading-list" aria-label="جاري التحميل">
              {[1, 2, 3, 4].map((item) => (
                <div className="ss-skeleton-row" key={item}>
                  <span />
                  <span />
                  <span />
                </div>
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="ss-empty-state">
              <div className="ss-empty-mark">
                <span>+</span>
              </div>
              <h3>{search.trim() ? "لا توجد نتائج مطابقة" : "لا توجد شركات شحن مضافة بعد"}</h3>
              <p>
                {search.trim()
                  ? "جرّب تغيير كلمات البحث أو امسح الفلتر الحالي."
                  : "ابدأ بإضافة أول شركة شحن ليظهر هنا."}
              </p>
            </div>
          ) : (
            <>
              <div className="ss-table-scroll">
                <table className="ss-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>الاسم</th>
                      <th>الكود</th>
                      <th>النوع</th>
                      <th>تكلفة الشحن</th>
                      <th>على العميل</th>
                      <th>الإرجاع</th>
                      <th>الحالة</th>
                      <th>الطلبات</th>
                      <th className="ss-actions-column">الإجراءات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, index) => (
                      <Fragment key={item.id}>
                        <tr>
                          <td>
                            <span className="ss-row-number">
                              {toArabicNumerals((page - 1) * pageSize + index + 1)}
                            </span>
                          </td>
                          <td>
                            <button
                              type="button"
                              onClick={() => void toggleCities(item)}
                              title="عرض نسب النجاح حسب المدينة"
                              style={{
                                background: "none",
                                border: "none",
                                cursor: "pointer",
                                padding: 0,
                                color: "var(--color-accent)",
                                textDecoration: "underline",
                                font: "inherit",
                                textAlign: "inherit",
                              }}
                            >
                              <span className="ss-item-name">{item.name}</span>
                            </button>
                          </td>
                          <td>
                            <span dir="ltr">{item.code}</span>
                          </td>
                          <td>{item.type === "INTEGRATED" ? "مدمجة" : "يدوية"}</td>
                          <td>{toArabicNumerals(Number(item.defaultShippingCost).toFixed(2))}</td>
                          <td>
                            {toArabicNumerals(Number(item.defaultCustomerShippingCost).toFixed(2))}
                          </td>
                          <td>{toArabicNumerals(Number(item.returnShippingCost).toFixed(2))}</td>
                          <td>
                            <ActiveBadge isActive={item.isActive} />
                          </td>
                          <td>{toArabicNumerals(String(item._count?.orders ?? 0))}</td>
                          <td className="ss-actions-column">
                            <div className="ss-row-actions">
                              <button
                                className="ss-icon-button ss-icon-edit"
                                onClick={() => startEdit(item)}
                                disabled={saving}
                                aria-label={`تعديل ${item.name}`}
                                title="تعديل"
                              >
                                <EditIcon />
                              </button>
                              <button
                                className="ss-icon-button ss-icon-delete"
                                onClick={() => void remove(item)}
                                disabled={saving}
                                aria-label={`حذف ${item.name}`}
                                title="حذف"
                              >
                                <TrashIcon />
                              </button>
                            </div>
                          </td>
                        </tr>
                        {expandedId === item.id && (
                          <tr key={`${item.id}-cities`}>
                            <td colSpan={10}>
                              {citiesLoading && !cityRates[item.id] ? (
                                <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
                                  جارٍ التحميل…
                                </span>
                              ) : (cityRates[item.id]?.length ?? 0) === 0 ? (
                                <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
                                  لا توجد بيانات مدن لهذه الشركة بعد
                                </span>
                              ) : (
                                <table className="co-items-table">
                                  <thead>
                                    <tr>
                                      <th>المدينة</th>
                                      <th>المؤكدة</th>
                                      <th>المسلّمة</th>
                                      <th>المرتجعة</th>
                                      <th>نسبة النجاح</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {cityRates[item.id].map((r) => (
                                      <tr key={r.cityId ?? r.cityName ?? "unknown"}>
                                        <td>{r.cityName ?? "—"}</td>
                                        <td>{toArabicNumerals(String(r.confirmedOrders))}</td>
                                        <td>{toArabicNumerals(String(r.deliveredOrders))}</td>
                                        <td>{toArabicNumerals(String(r.returnedOrders))}</td>
                                        <td>
                                          {toArabicNumerals(Number(r.successPercentage).toFixed(1))}
                                          %
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
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
                    الصفحة {toArabicNumerals(page)} من {toArabicNumerals(totalPages)} (
                    {toArabicNumerals(totalEntries)} شركة)
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
      </section>
    </div>
  );

  if (embedded) {
    return content;
  }

  return <DashboardLayout navigate={navigate}>{content}</DashboardLayout>;
}

function hashCode(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = (Math.imul(31, h) + text.charCodeAt(i)) | 0;
  }
  return h;
}
