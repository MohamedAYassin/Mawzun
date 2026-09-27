import { useState, useEffect, useCallback } from "react";
import DashboardLayout from "../../components/DashboardLayout/DashboardLayout";
import { toArabicNumerals } from "../../utils/arabicNumerals";
import {
  reportsApi,
  salesApi,
  type ShippingOverview,
  type OrderListItem,
  type OrderStatus,
  type Order,
  type CarrierUsage,
  type CarrierSpeed,
  type CarrierSuccess,
  type CarrierCost,
} from "../../lib/api";
import "../../styles/DashboardViews.css";

interface ShippingOverviewProps {
  navigate: (path: string) => void;
}

function CarrierStatsTable({
  tab,
  used,
  success,
  fastest,
  cost,
}: {
  tab: "used" | "success" | "fastest" | "cost";
  used: CarrierUsage[];
  success: CarrierSuccess[];
  fastest: CarrierSpeed[];
  cost: CarrierCost[];
}) {
  if (tab === "used") {
    if (used.length === 0)
      return (
        <div style={{ padding: "1rem", color: "var(--text-muted)", fontSize: "0.85rem" }}>
          لا توجد بيانات بعد
        </div>
      );
    return (
      <table className="co-items-table">
        <thead>
          <tr>
            <th>الشركة</th>
            <th>الطلبات</th>
            <th>النسبة</th>
          </tr>
        </thead>
        <tbody>
          {used.map((r) => (
            <tr key={r.carrierId}>
              <td>{r.carrierName}</td>
              <td>{toArabicNumerals(String(r.ordersCount))}</td>
              <td>{toArabicNumerals(Number(r.percentage).toFixed(1))}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  if (tab === "success") {
    if (success.length === 0)
      return (
        <div style={{ padding: "1rem", color: "var(--text-muted)", fontSize: "0.85rem" }}>
          لا توجد بيانات بعد
        </div>
      );
    return (
      <table className="co-items-table">
        <thead>
          <tr>
            <th>الشركة</th>
            <th>المؤكدة</th>
            <th>المسلّمة</th>
            <th>المرتجعة</th>
            <th>نسبة النجاح</th>
          </tr>
        </thead>
        <tbody>
          {success.map((r) => (
            <tr key={r.carrierId}>
              <td>{r.carrierName}</td>
              <td>{toArabicNumerals(String(r.confirmedOrders))}</td>
              <td>{toArabicNumerals(String(r.deliveredOrders))}</td>
              <td>{toArabicNumerals(String(r.returnedOrders))}</td>
              <td>{toArabicNumerals(Number(r.successPercentage).toFixed(1))}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  if (tab === "fastest") {
    if (fastest.length === 0)
      return (
        <div style={{ padding: "1rem", color: "var(--text-muted)", fontSize: "0.85rem" }}>
          لا توجد بيانات بعد
        </div>
      );
    return (
      <table className="co-items-table">
        <thead>
          <tr>
            <th>الشركة</th>
            <th>متوسط أيام التوصيل</th>
            <th>الطلبات المسلّمة</th>
          </tr>
        </thead>
        <tbody>
          {fastest.map((r) => (
            <tr key={r.carrierId}>
              <td>{r.carrierName}</td>
              <td>
                {r.averageDeliveryDays == null
                  ? "—"
                  : toArabicNumerals(Number(r.averageDeliveryDays).toFixed(1))}
              </td>
              <td>{toArabicNumerals(String(r.deliveredOrders))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  if (cost.length === 0)
    return (
      <div style={{ padding: "1rem", color: "var(--text-muted)", fontSize: "0.85rem" }}>
        لا توجد بيانات بعد
      </div>
    );
  return (
    <table className="co-items-table">
      <thead>
        <tr>
          <th>الشركة</th>
          <th>إجمالي تكلفة الشحن (ج.م)</th>
          <th>المتوسط (ج.م)</th>
          <th>الطلبات</th>
        </tr>
      </thead>
      <tbody>
        {cost.map((r) => (
          <tr key={r.carrierId}>
            <td>{r.carrierName}</td>
            <td>{toArabicNumerals(Number(r.totalShippingCost).toFixed(2))}</td>
            <td>{toArabicNumerals(Number(r.averageShippingCost).toFixed(2))}</td>
            <td>{toArabicNumerals(String(r.ordersCount))}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function ShippingOverview({ navigate }: ShippingOverviewProps) {
  const [data, setData] = useState<ShippingOverview | null>(null);
  const [carrierTab, setCarrierTab] = useState<"used" | "success" | "fastest" | "cost">("used");
  const [carriersUsed, setCarriersUsed] = useState<CarrierUsage[]>([]);
  const [carriersSuccess, setCarriersSuccess] = useState<CarrierSuccess[]>([]);
  const [carriersFastest, setCarriersFastest] = useState<CarrierSpeed[]>([]);
  const [carriersCost, setCarriersCost] = useState<CarrierCost[]>([]);
  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const [totalEntries, setTotalEntries] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<OrderStatus | "">("");
  const [page, setPage] = useState(1);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [overview, queue, used, success, fastest, cost] = await Promise.all([
        reportsApi.shippingOverview(),
        salesApi.listOrders({
          page,
          pageSize: 10,
          search: search.trim() || undefined,
          status: statusFilter || undefined,
        }),
        reportsApi.mostUsedCarriers({ top: 5 }),
        reportsApi.carrierSuccessRate({ top: 5 }),
        reportsApi.fastestCarriers({ top: 5 }),
        reportsApi.carrierCostStats({ top: 5 }),
      ]);
      setData(overview);
      setCarriersUsed(used.carriers);
      setCarriersSuccess(success.carriers);
      setCarriersFastest(fastest.carriers);
      setCarriersCost(cost.carriers);
      setOrders(queue.items);
      setTotalEntries(queue.total);
      setTotalPages(queue.totalPages);
    } catch {
    } finally {
      setLoading(false);
    }
  }, [page, search, statusFilter]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const d = data ?? {
    totalShipments: 0,
    deliveredCount: 0,
    deliveredAmount: 0,
    returnedCount: 0,
    returnedAmount: 0,
    notDeliveredCount: 0,
    totalShippingCost: 0,
  };

  // The five transitions the shipping desk drives, in the backend's vocabulary.
  const handleStatusChange = async (orderId: string, status: OrderStatus) => {
    setSaving(true);
    try {
      await salesApi.changeOrderStatus(orderId, { status });
      alert("تم تحديث حالة شحن الطلب.");
      await loadData();
    } catch (err) {
      alert(err instanceof Error ? err.message : "تعذر تحديث حالة شحن الطلب.");
    } finally {
      setSaving(false);
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <DashboardLayout navigate={navigate}>
      <div className="view-container">
        <div className="view-header" style={{ marginBottom: "1.5rem" }}>
          <div>
            <h1 className="view-header-title">لوحة عمليات الشحن</h1>
            <p className="view-header-subtitle">
              جدولة خروج الطلبات مع شركات الشحن المختلفة وتسجيل حالات تسليم الطرود.
            </p>
          </div>
        </div>

        <div className="co-metrics-grid">
          <div className="metric-card">
            <span className="metric-label">إجمالي الشحنات</span>
            <span className="metric-value">{toArabicNumerals(d.totalShipments)} طرد</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">قيمة الشحنات المسلمة</span>
            <span className="metric-value">
              {toArabicNumerals(d.deliveredAmount.toFixed(2))} ج.م
            </span>
          </div>
          <div className="metric-card">
            <span className="metric-label">طرود سُلّمت</span>
            <span className="metric-value">{toArabicNumerals(d.deliveredCount)} طرد</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">طرود مرتجعة</span>
            <span className="metric-value">{toArabicNumerals(d.returnedCount)} طرد</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">طرود لم تسلم</span>
            <span className="metric-value">{toArabicNumerals(d.notDeliveredCount)} طرد</span>
          </div>
        </div>

        <div className="io-data-surface" style={{ marginTop: "1rem" }}>
          <div
            style={{
              padding: "0.75rem 1rem",
              background: "var(--bg-secondary)",
              borderBottom: "1px solid var(--border-color)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: "0.5rem",
            }}
          >
            <strong style={{ fontSize: "0.85rem", color: "var(--text-primary)" }}>
              أداء شركات الشحن
            </strong>
            <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
              {(
                [
                  ["used", "الأكثر استخدامًا"],
                  ["success", "نسبة النجاح"],
                  ["fastest", "الأسرع"],
                  ["cost", "التكلفة"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setCarrierTab(key)}
                  style={{
                    padding: "0.3rem 0.7rem",
                    borderRadius: "999px",
                    fontSize: "0.78rem",
                    cursor: "pointer",
                    border: "1px solid var(--border-color)",
                    background: carrierTab === key ? "var(--accent)" : "transparent",
                    color: carrierTab === key ? "var(--color-accent-contrast)" : "var(--text-secondary)",
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <CarrierStatsTable
            tab={carrierTab}
            used={carriersUsed}
            success={carriersSuccess}
            fastest={carriersFastest}
            cost={carriersCost}
          />
        </div>

        <div className="io-data-surface" style={{ marginTop: "1rem" }}>
          <div
            style={{
              padding: "0.75rem 1rem",
              background: "var(--bg-secondary)",
              borderBottom: "1px solid var(--border-color)",
            }}
          >
            <strong style={{ fontSize: "0.85rem", color: "var(--text-primary)" }}>
              طابور حركة الشحن والتسليمات
            </strong>
          </div>

          <div className="co-filter-bar">
            <input
              type="text"
              placeholder="بحث برقم الطلب أو اسم العميل أو الهاتف..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value as OrderStatus | "");
                setPage(1);
              }}
            >
              <option value="">كل الحالات</option>
              <option value="CONFIRMED">تم التأكيد</option>
              <option value="ON_THE_WAY">في الطريق</option>
              <option value="NOT_DELIVERED">لم يسلم</option>
              <option value="RETURNED">تم الإرجاع</option>
            </select>
          </div>

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
          ) : orders.length === 0 ? (
            <div className="io-empty-state">
              <h3>لا توجد طلبات في قسم الشحن</h3>
              <p>انتظر حتى يتم تأكيد طلبات جديدة في لوحة المراجعة.</p>
            </div>
          ) : (
            <>
              <div className="io-table-scroll co-table-scroll">
                <table className="io-table">
                  <thead>
                    <tr>
                      <th style={{ width: "30px" }}></th>
                      <th>رقم الطلب</th>
                      <th>العميل</th>
                      <th>الهاتف</th>
                      <th>المحافظة</th>
                      <th>العنوان بالتفصيل</th>
                      <th>شركة الشحن</th>
                      <th>تكلفة الشحن</th>
                      <th>الحالة الحالية</th>
                      <th style={{ textAlign: "center" }}>إجراءات حركة الشحن</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((o) => (
                      <ShippingRow
                        key={o.id}
                        order={o}
                        expanded={expandedRows.has(o.id)}
                        onToggle={() => toggleExpand(o.id)}
                        saving={saving}
                        onStatusChange={handleStatusChange}
                      />
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
                    {toArabicNumerals(totalEntries)} طلب)
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
    </DashboardLayout>
  );
}

function ShippingRow({
  order,
  expanded,
  onToggle,
  saving,
  onStatusChange,
}: {
  order: OrderListItem;
  expanded: boolean;
  onToggle: () => void;
  saving: boolean;
  onStatusChange: (orderId: string, status: OrderStatus) => void;
}) {
  // The list endpoint carries summary rows only; the expanded panel is drawn
  // from the full order, fetched once when the row is opened.
  const [detail, setDetail] = useState<Order | null>(null);
  useEffect(() => {
    if (!expanded || detail) return;
    let cancelled = false;
    salesApi
      .getOrder(order.id)
      .then((full) => {
        if (!cancelled) setDetail(full);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [expanded, detail, order.id]);

  const STATUS_LABEL: Record<OrderStatus, string> = {
    NEW: "جديد",
    CONFIRMED: "مؤكد",
    POSTPONED: "مؤجل",
    CANCELLED: "ملغي",
    NO_ANSWER: "لا يرد",
    DELIVERED: "تم التسليم",
    RETURNED: "مرتجع",
    NOT_DELIVERED: "لم يُسلّم",
    ON_THE_WAY: "في الطريق",
    RETURNED_TO_WAREHOUSE: "رُجع للمخزن",
  };
  const money = (v: string | number) => toArabicNumerals(Number(v).toFixed(2));
  const statusBadgeStyle: React.CSSProperties = {
    background:
      order.status === "ON_THE_WAY"
        ? "var(--color-accent-soft)"
        : order.status === "CONFIRMED"
          ? "#e8f5e9"
          : order.status === "NOT_DELIVERED"
            ? "#fff3e0"
            : "#fce4ec",
    color:
      order.status === "ON_THE_WAY"
        ? "var(--color-accent)"
        : order.status === "CONFIRMED"
          ? "var(--color-success)"
          : order.status === "NOT_DELIVERED"
            ? "#e65100"
            : "var(--color-danger)",
  };

  const statusIcon = expanded ? "▾" : "▸";
  const discountAmount = Number(order.orderPrice) * (Number(order.discountPercentage) / 100);

  return (
    <>
      <tr className="co-row" onClick={onToggle} style={{ cursor: "pointer" }}>
        <td style={{ textAlign: "center", fontSize: "0.7rem", userSelect: "none" }}>
          {statusIcon}
        </td>
        <td>
          <strong style={{ fontFamily: "monospace" }}>{order.orderNumber}</strong>
        </td>
        <td>
          <span className="io-item-name">{order.customer.name}</span>
        </td>
        <td>
          <span>{toArabicNumerals(order.customer.phoneNumber1)}</span>
        </td>
        <td>
          <span>{order.shippingGovernorate?.name || "—"}</span>
        </td>
        <td>
          <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>—</span>
        </td>
        <td>
          <span>{order.carrier?.name || "غير معين"}</span>
        </td>
        <td>
          <span>{money(order.shippingCost)} ج.م</span>
        </td>
        <td>
          <span className="io-related-badge" style={statusBadgeStyle}>
            {STATUS_LABEL[order.status]}
          </span>
          {order.hasShortage && <span className="co-shortage-badge">⚠️ عجز مخزون</span>}
        </td>
        <td style={{ textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
          <div style={{ display: "flex", gap: "0.35rem", justifyContent: "center" }}>
            {order.status === "CONFIRMED" && (
              <button
                className="co-btn co-btn-confirm"
                onClick={() => onStatusChange(order.id, "ON_THE_WAY")}
                disabled={saving}
              >
                خروج للتوصيل
              </button>
            )}
            {order.status === "ON_THE_WAY" && (
              <>
                <button
                  className="co-btn"
                  style={{ background: "var(--color-success)", color: "var(--color-white)" }}
                  onClick={() => onStatusChange(order.id, "DELIVERED")}
                  disabled={saving}
                >
                  تم التسليم
                </button>
                <button
                  className="co-btn"
                  style={{
                    background: "var(--bg-secondary)",
                    color: "var(--text-primary)",
                    border: "1px solid #dcdfe6",
                  }}
                  onClick={() => onStatusChange(order.id, "NOT_DELIVERED")}
                  disabled={saving}
                >
                  لم يسلم
                </button>
                <button
                  className="co-btn co-btn-cancel"
                  onClick={() => onStatusChange(order.id, "RETURNED")}
                  disabled={saving}
                >
                  تم الإرجاع
                </button>
              </>
            )}
            {(order.status === "NOT_DELIVERED" || order.status === "RETURNED") && (
              <button
                className="co-btn"
                style={{ background: "var(--bg-subtle)", color: "var(--text-primary)" }}
                onClick={() => onStatusChange(order.id, "RETURNED_TO_WAREHOUSE")}
                disabled={saving}
              >
                إرجاع للمستودع
              </button>
            )}
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className="co-expanded-row">
          <td colSpan={10}>
            <div className="co-expanded-content">
              <div className="co-expanded-grid">
                <div className="co-expanded-section">
                  <h4>معلومات الطلب</h4>
                  <div>
                    <span>رقم الطلب:</span> {order.orderNumber}
                  </div>
                  <div>
                    <span>تاريخ الإنشاء:</span>{" "}
                    {new Date(order.createdAt).toLocaleDateString("ar-EG")}
                  </div>
                  <div>
                    <span>النوع:</span> {order.type}
                  </div>
                  <div>
                    <span>الحالة:</span> {STATUS_LABEL[order.status]}
                  </div>
                  <div>
                    <span>مصدر الطلب:</span> {order.orderSource?.name || "—"}
                  </div>
                  <div>
                    <span>طريقة الدفع:</span> {order.paymentMethod?.name || "—"}
                  </div>
                </div>
                <div className="co-expanded-section">
                  <h4>معلومات العميل</h4>
                  <div>
                    <span>الاسم:</span> {order.customer.name}
                  </div>
                  <div>
                    <span>الهاتف الأساسي:</span> {toArabicNumerals(order.customer.phoneNumber1)}
                  </div>
                  <div>
                    <span>المحافظة:</span> {order.shippingGovernorate?.name || "—"}
                  </div>
                  <div>
                    <span>المدينة:</span> {order.city?.name || "—"}
                  </div>
                  {detail?.detailedAddress && (
                    <div>
                      <span>العنوان:</span> {detail.detailedAddress}
                    </div>
                  )}
                </div>
                <div className="co-expanded-section">
                  <h4>الشحن والتوصيل</h4>
                  <div>
                    <span>شركة الشحن:</span> {order.carrier?.name || "—"}
                  </div>
                  <div>
                    <span>تكلفة الشحن:</span> {money(order.shippingCost)} ج.م
                  </div>
                  <div>
                    <span>المستودع:</span> {order.warehouse?.name || "—"}
                  </div>
                </div>
                <div className="co-expanded-section">
                  <h4>التسعير والخصم</h4>
                  <div>
                    <span>سعر الطلب:</span> {money(order.orderPrice)} ج.م
                  </div>
                  <div>
                    <span>نسبة الخصم:</span> {toArabicNumerals(String(order.discountPercentage))}%
                  </div>
                  <div>
                    <span>قيمة الخصم:</span> {toArabicNumerals(discountAmount.toFixed(2))} ج.م
                  </div>
                  <div>
                    <span>السعر الفعلي:</span> <strong>{money(order.orderActualPrice)} ج.م</strong>
                  </div>
                </div>
              </div>
              {detail?.notes && (
                <div className="co-expanded-section co-expanded-full">
                  <h4>ملاحظات</h4>
                  <div>{detail.notes}</div>
                </div>
              )}
              <div className="co-expanded-section co-expanded-full">
                <h4>المنتجات ({toArabicNumerals(detail?.items.length ?? order._count.items)})</h4>
                <table className="co-items-table">
                  <thead>
                    <tr>
                      <th>المنتج</th>
                      <th>الكمية</th>
                      <th>الكمية المؤكدة</th>
                      <th>سعر الوحدة</th>
                      <th>الإجمالي</th>
                      <th>الضريبة</th>
                      <th>حالة التصنيع</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail?.items.map((item) => (
                      <tr key={item.id}>
                        <td>{item.product.name}</td>
                        <td>{toArabicNumerals(String(item.quantity))}</td>
                        <td>{toArabicNumerals(String(item.confirmedQuantity))}</td>
                        <td>{money(item.unitPrice)} ج.م</td>
                        <td>{money(Number(item.unitPrice) * item.quantity)} ج.م</td>
                        <td>
                          {item.itemDiscountAmount && Number(item.itemDiscountAmount) > 0
                            ? `${money(item.itemDiscountAmount)} ج.م`
                            : "—"}
                        </td>
                        <td>
                          {item.needsManufacturing ? (
                            <span className="co-needs-mfg">يحتاج تصنيع</span>
                          ) : (
                            <span className="co-available">متوفر</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
