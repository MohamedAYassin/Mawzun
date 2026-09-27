import { Fragment,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";
import DashboardLayout from "../../components/DashboardLayout/DashboardLayout";
import { usePathname } from "../../lib/navigation";
import {
  inventoryApi,
  catalogApi,
  type OperationType,
  type ProductListItem,
  type StockOperation,
  type StockOperationStatus,
} from "../../lib/api";
import { useCurrentUser } from "../../hooks/useCurrentUser";
import {
  ActiveBadge,
  Button,
  EditorActions,
  EditorHeader,
  EmptyState,
  LoadingState,
  ListToolbar,
  ModuleHeading,
  StatusBanner,
  BoxIcon,
  PlusIcon,
  type Notice,
} from "../shared/ManagementUi";
import "../SystemSettings/SystemSettings.css";

interface OperationsManagementProps {
  navigate: (path: string) => void;
}

const STATUS_LABELS: Record<StockOperationStatus, string> = {
  DRAFT: "مسودة",
  PENDING: "معلق",
  READY: "جاهزة",
  DONE: "مكتملة",
  CANCELLED: "ملغاة",
};
const STATUS_COLORS: Record<StockOperationStatus, CSSProperties> = {
  DRAFT: { background: "var(--border-color)", color: "var(--text-secondary)" },
  PENDING: { background: "var(--color-warning-soft)", color: "var(--color-warning)" },
  READY: { background: "var(--color-warning-soft)", color: "var(--color-warning)" },
  DONE: { background: "var(--color-success-soft)", color: "var(--color-success)" },
  CANCELLED: { background: "var(--color-danger-soft)", color: "var(--color-danger)" },
};

function emptyType(): Omit<OperationType, "id" | "nextSequence" | "createdAt"> {
  return {
    name: "",
    code: "",
    description: "",
    requiresValidation: false,
    sequencePrefix: "OP",
    reservationMethod: "MANUAL",
    isActive: true,
  };
}

function TypesTab() {
  const [items, setItems] = useState<OperationType[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<OperationType | null>(null);
  const [form, setForm] = useState(emptyType());
  const [notice, setNotice] = useState<Notice | null>(null);
  const [lastLoaded, setLastLoaded] = useState<Date | null>(null);
  const permissions = [] as string[];
  const roles = [] as string[];
  const canManage =
    roles.includes("Admin") || permissions.includes("Permissions.ManageStockOperations");

  const load = useCallback(
    async (showLoader = true, search = query) => {
      if (showLoader) setLoading(true);
      try {
        const result = await inventoryApi.listOperationTypes({ search });
        setItems(result);
        setLastLoaded(new Date());
      } catch (error) {
        setNotice({
          type: "error",
          text: error instanceof Error ? error.message : "تعذر تحميل أنواع العمليات.",
        });
      } finally {
        setLoading(false);
      }
    },
    [query],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(
    () =>
      items.filter(
        (item) =>
          !query.trim() || `${item.name} ${item.code}`.toLowerCase().includes(query.toLowerCase()),
      ),
    [items, query],
  );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      if (editing) await inventoryApi.updateOperationType(editing.id, form);
      else await inventoryApi.createOperationType(form);
      setNotice({
        type: "success",
        text: editing ? "تم تحديث نوع العملية." : "تم إضافة نوع العملية.",
      });
      setFormOpen(false);
      setEditing(null);
      setForm(emptyType());
      await load(false);
    } catch (error) {
      setNotice({
        type: "error",
        text: error instanceof Error ? error.message : "تعذر حفظ نوع العملية.",
      });
    } finally {
      setSaving(false);
    }
  };

  const remove = async (item: OperationType) => {
    if (!window.confirm(`حذف ${item.name}؟`)) return;
    try {
      await inventoryApi.deleteOperationType(item.id);
      setNotice({ type: "success", text: "تم حذف نوع العملية." });
      await load(false);
    } catch (error) {
      setNotice({
        type: "error",
        text: error instanceof Error ? error.message : "تعذر حذف نوع العملية.",
      });
    }
  };

  return (
    <>
      <ModuleHeading
        icon={<BoxIcon />}
        eyebrow="المخازن"
        title="أنواع عمليات المخزون"
        subtitle="تحديد أنواع الاستلام والتحويل والتسوية مع بادئة الترقيم وطريقة الحجز."
      />
      <div className="ss-module-actions">
        <span className="ss-count-chip">
          <strong>{visible.length}</strong> نوع عملية
        </span>
        <Button variant="ghost" onClick={() => void load()} disabled={loading || saving}>
          تحديث
        </Button>
        {canManage && (
          <Button
            onClick={() => {
              setEditing(null);
              setForm(emptyType());
              setFormOpen(true);
            }}
            disabled={saving}
          >
            <PlusIcon /> نوع جديد
          </Button>
        )}
      </div>
      <StatusBanner notice={notice} />
      <ListToolbar
        query={query}
        setQuery={setQuery}
        placeholder="ابحث بالاسم أو الكود..."
        lastLoaded={lastLoaded}
      />
      {formOpen && (
        <form className="ss-editor-surface" onSubmit={submit}>
          <EditorHeader editing={Boolean(editing)} singular="نوع العملية" />
          <div className="ss-form-grid">
            <label>
              الاسم
              <input
                className="ss-input"
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                required
              />
            </label>
            <label>
              الكود
              <input
                className="ss-input"
                value={form.code}
                onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })}
                required
              />
            </label>
            <label>
              بادئة الترقيم
              <input
                className="ss-input"
                value={form.sequencePrefix}
                onChange={(event) =>
                  setForm({ ...form, sequencePrefix: event.target.value.toUpperCase() })
                }
                required
              />
            </label>
            <label>
              طريقة الحجز
              <select
                className="ss-input"
                value={form.reservationMethod}
                onChange={(event) =>
                  setForm({
                    ...form,
                    reservationMethod: event.target.value as OperationType["reservationMethod"],
                  })
                }
              >
                <option value="MANUAL">يدوي</option>
                <option value="FIFO">الأقدم أولاً</option>
                <option value="LIFO">الأحدث أولاً</option>
              </select>
            </label>
            <label>
              الوصف
              <input
                className="ss-input"
                value={form.description || ""}
                onChange={(event) => setForm({ ...form, description: event.target.value })}
              />
            </label>
            <label className="ss-checkbox">
              <input
                type="checkbox"
                checked={form.requiresValidation}
                onChange={(event) => setForm({ ...form, requiresValidation: event.target.checked })}
              />{" "}
              يتطلب تأكيدًا
            </label>
            <label className="ss-checkbox">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(event) => setForm({ ...form, isActive: event.target.checked })}
              />{" "}
              نشط
            </label>
          </div>
          <EditorActions
            closeForm={() => setFormOpen(false)}
            saving={saving}
            editing={Boolean(editing)}
          />
        </form>
      )}
      <div className="ss-data-surface">
        {loading ? (
          <LoadingState />
        ) : visible.length === 0 ? (
          <EmptyState hasSearch={Boolean(query.trim())} />
        ) : (
          <div className="ss-table-scroll">
            <table className="ss-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>الاسم</th>
                  <th>الكود</th>
                  <th>بادئة الترقيم</th>
                  <th>الحجز</th>
                  <th>التأكيد</th>
                  <th>الحالة</th>
                  <th>إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((item, index) => (
                  <tr key={item.id}>
                    <td>{index + 1}</td>
                    <td>{item.name}</td>
                    <td>
                      <span dir="ltr">{item.code}</span>
                    </td>
                    <td>
                      <span dir="ltr">{item.sequencePrefix}</span>
                    </td>
                    <td>{item.reservationMethod}</td>
                    <td>{item.requiresValidation ? "نعم" : "لا"}</td>
                    <td>
                      <ActiveBadge isActive={item.isActive} />
                    </td>
                    <td className="ss-actions-column">
                      {canManage && (
                        <div className="ss-row-actions">
                          <Button
                            variant="ghost"
                            onClick={() => {
                              setEditing(item);
                              setForm({
                                name: item.name,
                                code: item.code,
                                description: item.description,
                                requiresValidation: item.requiresValidation,
                                sequencePrefix: item.sequencePrefix,
                                reservationMethod: item.reservationMethod,
                                isActive: item.isActive,
                              });
                              setFormOpen(true);
                            }}
                          >
                            تعديل
                          </Button>
                          <Button variant="danger" onClick={() => void remove(item)}>
                            حذف
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

function StockOperationsTab() {
  const [items, setItems] = useState<StockOperation[]>([]);
  const [types, setTypes] = useState<OperationType[]>([]);
  const [products, setProducts] = useState<ProductListItem[]>([]);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unitCost, setUnitCost] = useState("0");
  const [reference, setReference] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [lastLoaded, setLastLoaded] = useState<Date | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const { hasPermission } = useCurrentUser();
  const canManage = hasPermission("Permissions.ManageStockOperations");

  const load = useCallback(async (showLoader = true) => {
    if (showLoader) setLoading(true);
    try {
      const [operations, operationTypes, productResult] = await Promise.all([
        inventoryApi.listStockOperations({ pageSize: 100 }),
        inventoryApi.listOperationTypes(),
        catalogApi.listProducts({ pageSize: 200, isActive: true }),
      ]);
      setItems(operations.items);
      setTypes(operationTypes);
      setProducts(productResult.items);
      setLastLoaded(new Date());
    } catch (error) {
      setNotice({
        type: "error",
        text: error instanceof Error ? error.message : "تعذر تحميل حركات المخزون.",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(
    () =>
      items
        .filter((item) => !typeFilter || item.operationType.id === typeFilter)
        .filter(
          (item) =>
            !query.trim() ||
            `${item.operationNumber} ${item.reference || ""}`
              .toLowerCase()
              .includes(query.toLowerCase()),
        ),
    [items, query, typeFilter],
  );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!types.length || !productId) return;
    setSaving(true);
    try {
      await inventoryApi.createStockOperation({
        operationTypeId: types[0].id,
        reference,
        items: [{ productId, quantity: Number(quantity), unitCost: Number(unitCost) }],
      });
      setNotice({ type: "success", text: "تم إنشاء الحركة كمعلقة." });
      setFormOpen(false);
      setProductId("");
      setQuantity("1");
      setUnitCost("0");
      setReference("");
      await load(false);
    } catch (error) {
      setNotice({
        type: "error",
        text: error instanceof Error ? error.message : "تعذر إنشاء الحركة.",
      });
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async (item: StockOperation, status: StockOperationStatus) => {
    try {
      if (status === "DONE") await inventoryApi.executeStockOperation(item.id);
      else if (status === "CANCELLED") await inventoryApi.cancelStockOperation(item.id);
      await load(false);
    } catch (error) {
      setNotice({
        type: "error",
        text: error instanceof Error ? error.message : "تعذر تحديث الحالة.",
      });
    }
  };

  return (
    <>
      <ModuleHeading
        icon={<BoxIcon />}
        eyebrow="المخازن"
        title="حركات المخزون"
        subtitle="سجل عمليات الاستلام والصرف والتحويل وحالات التنفيذ."
      />
      <div className="ss-module-actions">
        <span className="ss-count-chip">
          <strong>{visible.length}</strong> حركة
        </span>
        <Button variant="ghost" onClick={() => void load()} disabled={loading || saving}>
          تحديث
        </Button>
        {canManage && (
          <Button onClick={() => setFormOpen((open) => !open)} disabled={saving}>
            <PlusIcon /> حركة جديدة
          </Button>
        )}
      </div>
      <StatusBanner notice={notice} />
      <div className="ss-list-toolbar">
        <ListToolbar
          query={query}
          setQuery={setQuery}
          placeholder="ابحث برقم العملية أو المرجع..."
          lastLoaded={lastLoaded}
        />
        <select
          className="ss-input"
          value={typeFilter}
          onChange={(event) => setTypeFilter(event.target.value)}
          aria-label="فلتر نوع العملية"
        >
          <option value="">كل الأنواع</option>
          {types.map((type) => (
            <option key={type.id} value={type.id}>
              {type.name}
            </option>
          ))}
        </select>
      </div>
      {formOpen && (
        <form className="ss-editor-surface" onSubmit={submit}>
          <EditorHeader editing={false} singular="حركة مخزون" />
          <div className="ss-form-grid">
            <label>
              المنتج
              <select
                className="ss-input"
                value={productId}
                onChange={(event) => setProductId(event.target.value)}
                required
              >
                <option value="">اختر منتجًا</option>
                {products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              الكمية
              <input
                className="ss-input"
                type="number"
                min="1"
                step="1"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                required
              />
            </label>
            <label>
              تكلفة الوحدة
              <input
                className="ss-input"
                type="number"
                min="0"
                step="0.01"
                value={unitCost}
                onChange={(event) => setUnitCost(event.target.value)}
              />
            </label>
            <label>
              المرجع
              <input
                className="ss-input"
                value={reference}
                onChange={(event) => setReference(event.target.value)}
              />
            </label>
          </div>
          <EditorActions closeForm={() => setFormOpen(false)} saving={saving} editing={false} />
        </form>
      )}
      <div className="ss-data-surface">
        {loading ? (
          <LoadingState />
        ) : visible.length === 0 ? (
          <EmptyState hasSearch={Boolean(query.trim() || typeFilter)} />
        ) : (
          <div className="ss-table-scroll">
            <table className="ss-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>رقم العملية</th>
                  <th>النوع</th>
                  <th>الأصناف</th>
                  <th>الكمية</th>
                  <th>المرجع</th>
                  <th>الحالة</th>
                  <th>إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((item, index) => (
                  <Fragment key={item.id}>
                  <tr>
                    <td>{index + 1}</td>
                    <td>
                      <button
                        dir="ltr"
                        onClick={() => setExpandedId((id) => (id === item.id ? null : item.id))}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--color-accent)', textDecoration: 'underline', fontFamily: 'monospace' }}
                        title="عرض التفاصيل"
                      >
                        {item.operationNumber}
                      </button>
                    </td>
                    <td>{item.operationType.name}</td>
                    <td>{item.items.length}</td>
                    <td>{item.items.reduce((sum, row) => sum + Number(row.quantity), 0)}</td>
                    <td>{item.reference || "—"}</td>
                    <td>
                      <span className="ss-related-badge" style={STATUS_COLORS[item.status]}>
                        {STATUS_LABELS[item.status]}
                      </span>
                    </td>
                    <td className="ss-actions-column">
                      {canManage && item.status === "PENDING" && (
                        <div className="ss-row-actions">
                          <Button
                            variant="secondary"
                            onClick={() => void changeStatus(item, "DONE")}
                          >
                            تنفيذ
                          </Button>
                          <Button
                            variant="danger"
                            onClick={() => void changeStatus(item, "CANCELLED")}
                          >
                            إلغاء
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                  {expandedId === item.id && (
                    <tr>
                      <td colSpan={8}>
                        <div style={{ background: 'var(--bg-secondary)', borderRadius: 10, padding: '0.9rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                          <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', fontSize: '0.85rem' }}>
                            <div><strong>من:</strong> {item.fromWarehouse?.name ?? '—'}</div>
                            <div><strong>إلى:</strong> {item.toWarehouse?.name ?? '—'}</div>
                            <div><strong>نفذها:</strong> {item.executedBy?.fullName ?? '—'}</div>
                            <div><strong>تاريخ التنفيذ:</strong> {item.executedAt ? new Date(item.executedAt).toLocaleString('ar-EG') : '—'}</div>
                            {item.notes && <div style={{ flex: '1 1 100%' }}><strong>ملاحظات:</strong> {item.notes}</div>}
                          </div>
                          <table className="ss-table" style={{ fontSize: '0.8rem' }}>
                            <thead>
                              <tr><th>الصنف</th><th>المتغير</th><th>المخطط</th><th>المنفذ</th><th>المتبقي</th><th>التكلفة</th></tr>
                            </thead>
                            <tbody>
                              {item.items.map((row) => {
                                const planned = Number(row.quantity)
                                const done = Number(row.doneQuantity)
                                return (
                                  <tr key={row.id}>
                                    <td>{row.product.name}</td>
                                    <td>{row.variant ? `${row.variant.name} (${row.variant.skuCode})` : '—'}</td>
                                    <td>{planned}</td>
                                    <td>{done}</td>
                                    <td style={{ color: planned - done > 0 ? '#e65100' : '#2e7d32' }}>{planned - done}</td>
                                    <td>{row.unitCost != null ? Number(row.unitCost).toLocaleString('ar-EG') : '—'}</td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      </td>
                    </tr>

                  )}
                      </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

export default function OperationsManagement({ navigate }: OperationsManagementProps) {
  const pathname = usePathname();
  const [tab, setTab] = useState<"operations" | "types">(
    pathname.includes("operation-types") ? "types" : "operations",
  );
  return (
    <DashboardLayout navigate={navigate}>
      <div className="view-container">
        <section className="ss-module animate-fade-in">
          <div className="ss-list-toolbar">
            <Button
              variant={tab === "operations" ? "primary" : "ghost"}
              onClick={() => {
                setTab("operations");
                navigate("/dashboard/stock-operations");
              }}
            >
              الحركات
            </Button>
            <Button
              variant={tab === "types" ? "primary" : "ghost"}
              onClick={() => {
                setTab("types");
                navigate("/dashboard/operation-types");
              }}
            >
              الأنواع
            </Button>
          </div>
          {tab === "types" ? <TypesTab /> : <StockOperationsTab />}
        </section>
      </div>
    </DashboardLayout>
  );
}
