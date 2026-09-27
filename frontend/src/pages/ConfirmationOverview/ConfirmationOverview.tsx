import { useState, useEffect, useCallback } from "react";
import DashboardLayout from "../../components/DashboardLayout/DashboardLayout";
import { toArabicNumerals } from "../../utils/arabicNumerals";
import {
  reportsApi,
  salesApi,
  type OrderListItem,
  type Order,
  type OrderStatus,
  type OrderConfigEntry,
  type ProductConfirmation,
} from "../../lib/api";
import { Select } from "../../components/Select/Select";
import "../../styles/DashboardViews.css";
import "./ConfirmationOverview.css";

interface ConfirmationOverviewProps {
  navigate: (path: string) => void;
}

export default function ConfirmationOverview({ navigate }: ConfirmationOverviewProps) {
  type ConfirmationStats = {
    count: number;
    totalAmount: number;
    deliveredCount: number;
    deliveryPercentage: number;
  };
  const [data, setData] = useState<ConfirmationStats | null>(null);
  const [productConfirmation, setProductConfirmation] = useState<ProductConfirmation[]>([]);
  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const [totalEntries, setTotalEntries] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<OrderStatus | "">("");
  const [page, setPage] = useState(1);

  const [cancelReasons, setCancelReasons] = useState<OrderConfigEntry[]>([]);
  const [cancelDialog, setCancelDialog] = useState<{ orderId: string; orderNumber: string } | null>(
    null,
  );
  const [selectedCancelReasonId, setSelectedCancelReasonId] = useState("");
  // Blocking alert() freezes the whole tab — including every queued click —
  // until it is dismissed, which made the queue feel dead after the first
  // action. A toast informs without seizing the event loop.
  const [notice, setNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [stats, prodConf, queue] = await Promise.all([
        reportsApi.confirmedOrdersStats(),
        reportsApi.productConfirmation(),
        salesApi.listOrders({
          page,
          pageSize: 10,
          search: search.trim() || undefined,
          status: statusFilter || undefined,
        }),
      ]);
      setData(stats);
      setProductConfirmation(prodConf.products);
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

  useEffect(() => {
    void salesApi
      .listCancelReasons()
      .then(setCancelReasons)
      .catch(() => {});
  }, []);

  const d = data ?? { count: 0, totalAmount: 0, deliveredCount: 0, deliveryPercentage: 0 };

  const handleStatusChange = async (
    orderId: string,
    status: OrderStatus,
    cancelReasonId?: string,
  ) => {
    setSaving(true);
    try {
      await salesApi.changeOrderStatus(orderId, { status, cancelReasonId: cancelReasonId ?? null });
      setNotice({ type: "success", text: "تم تحديث حالة الطلب بنجاح." });
      await loadData();
    } catch (err) {
      setNotice({
        type: "error",
        text: err instanceof Error ? err.message : "تعذر تحديث حالة الطلب.",
      });
    } finally {
      setSaving(false);
    }
  };

  const openCancelDialog = (orderId: string, orderNumber: string) => {
    setSelectedCancelReasonId(cancelReasons.length > 0 ? cancelReasons[0].id : "");
    setCancelDialog({ orderId, orderNumber });
  };

  const confirmCancel = () => {
    if (!cancelDialog) return;
    if (!selectedCancelReasonId) {
      setNotice({ type: "error", text: "يرجى اختيار سبب الإلغاء." });
      return;
    }
    handleStatusChange(cancelDialog.orderId, "CANCELLED", selectedCancelReasonId);
    setCancelDialog(null);
    setSelectedCancelReasonId("");
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
            <h1 className="view-header-title">تاكيد الطلبات</h1>
            <p className="view-header-subtitle">
              طابور تأكيد المبيعات والطلبات الجديدة الواردة من المنصات المختلفة.
            </p>
          </div>
        </div>

        {notice && (
          <div
            role={notice.type === "error" ? "alert" : "status"}
            style={{
              padding: "0.6rem 1rem",
              marginBottom: "1rem",
              borderRadius: "var(--radius-md)",
              fontSize: "0.85rem",
              background: notice.type === "success" ? "var(--color-success-soft)" : "var(--color-danger-soft)",
              color: notice.type === "success" ? "var(--color-success)" : "var(--color-danger)",
              border: "1px solid " + (notice.type === "success" ? "var(--color-success)" : "var(--color-danger)"),
            }}
          >
            {notice.text}
          </div>
        )}

        <div className="co-metrics-grid">
          <div className="metric-card">
            <span className="metric-label">طلبات معلقة بانتظار التأكيد</span>
            <span className="metric-value">{toArabicNumerals(d.count)} طلب</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">قيمة الطلبات المعلقة</span>
            <span className="metric-value">{toArabicNumerals(d.totalAmount.toFixed(2))} ج.م</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">طلبات اليوم الجديدة</span>
            <span className="metric-value">
              {toArabicNumerals(d.deliveryPercentage.toFixed(0))}%
            </span>
          </div>
          <div className="metric-card">
            <span className="metric-label">بانتظار الاتصال</span>
            <span className="metric-value">{toArabicNumerals(d.deliveredCount)} طلب</span>
          </div>
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
              نسب تأكيد المنتجات
            </strong>
          </div>
          {productConfirmation.length === 0 ? (
            <div style={{ padding: "1rem", color: "var(--text-muted)", fontSize: "0.85rem" }}>
              لا توجد بيانات بعد
            </div>
          ) : (
            <div className="io-table-scroll co-table-scroll">
              <table className="co-items-table">
                <thead>
                  <tr>
                    <th>المنتج</th>
                    <th>الكود</th>
                    <th>إجمالي الطلبات</th>
                    <th>المؤكدة</th>
                    <th>نسبة التأكيد</th>
                  </tr>
                </thead>
                <tbody>
                  {productConfirmation.map((pc) => (
                    <tr key={pc.productId}>
                      <td>{pc.productName}</td>
                      <td>
                        <span dir="ltr">{pc.skuCode}</span>
                      </td>
                      <td>{toArabicNumerals(String(pc.totalOrders))}</td>
                      <td>{toArabicNumerals(String(pc.confirmedOrders))}</td>
                      <td>{toArabicNumerals(Number(pc.confirmationPercentage).toFixed(1))}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
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
              طابور المراجعة والاتصال بالعملاء
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
              <option value="NEW">جديد</option>
              <option value="NO_ANSWER">لم يرد</option>
              <option value="POSTPONED">مؤجل</option>
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
              <h3>طابور التأكيد فارغ تماماً!</h3>
              <p>جميع الطلبات تمت معالجتها وتأكيدها بنجاح.</p>
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
                      <th>الهاتف الأساسي</th>
                      <th>الهاتف البديل</th>
                      <th>المحافظة</th>
                      <th>المستودع</th>
                      <th>الصافي</th>
                      <th>الحالة الحالية</th>
                      <th style={{ textAlign: "center" }}>إجراءات التأكيد والاتصال</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((o) => (
                      <ExpandableRow
                        key={o.id}
                        order={o}
                        expanded={expandedRows.has(o.id)}
                        onToggle={() => toggleExpand(o.id)}
                        saving={saving}
                        onStatusChange={handleStatusChange}
                        onCancelClick={() => openCancelDialog(o.id, o.orderNumber)}
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

      {cancelDialog && (
        <div className="co-modal-overlay" onClick={() => setCancelDialog(null)}>
          <div className="co-modal" onClick={(e) => e.stopPropagation()}>
            <h3>إلغاء الطلب {cancelDialog.orderNumber}</h3>
            <p
              style={{ fontSize: "0.85rem", color: "var(--text-secondary)", marginBottom: "1rem" }}
            >
              يرجى اختيار سبب الإلغاء:
            </p>
            <Select
              value={selectedCancelReasonId}
              onChange={(v) => setSelectedCancelReasonId(v)}
              options={cancelReasons.map((r) => ({ value: r.id, label: r.name }))}
              loading={cancelReasons.length === 0}
              placeholder="اختر سبب الإلغاء"
            />
            <div
              style={{
                display: "flex",
                gap: "0.5rem",
                justifyContent: "flex-end",
                marginTop: "1rem",
              }}
            >
              <button
                onClick={() => setCancelDialog(null)}
                style={{
                  padding: "0.4rem 1rem",
                  border: "1px solid var(--border-color)",
                  borderRadius: 6,
                  background: "var(--bg-primary)",
                  cursor: "pointer",
                  fontSize: "0.8rem",
                }}
              >
                تراجع
              </button>
              <button
                onClick={confirmCancel}
                disabled={saving}
                className="co-btn co-btn-cancel"
                style={{ fontSize: "0.8rem" }}
              >
                {saving ? "جاري الإلغاء..." : "تأكيد الإلغاء"}
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}

function ExpandableRow({
  order,
  expanded,
  onToggle,
  saving,
  onStatusChange,
  onCancelClick,
}: {
  order: OrderListItem;
  expanded: boolean;
  onToggle: () => void;
  saving: boolean;
  onStatusChange: (orderId: string, status: OrderStatus, cancelReasonId?: string) => void;
  onCancelClick: () => void;
}) {
  // The expanded panel needs the full order (items, notes, address); the list
  // row only carries a summary. Fetch once when the row opens.
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
  const statusBadgeStyle = {
    background:
      order.status === "NO_ANSWER"
        ? "var(--bg-secondary)"
        : order.status === "POSTPONED"
          ? "var(--color-warning-soft)"
          : "var(--color-success-soft)",
    color:
      order.status === "NO_ANSWER"
        ? "var(--text-secondary)"
        : order.status === "POSTPONED"
          ? "var(--color-warning)"
          : "var(--color-success)",
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
          <span>—</span>
        </td>
        <td>
          <span>{order.shippingGovernorate?.name || "—"}</span>
        </td>
        <td>
          <span>{order.warehouse?.name || "—"}</span>
        </td>
        <td>
          <strong>{money(order.orderActualPrice)} ج.م</strong>
        </td>
        <td>
          <span className="io-related-badge" style={statusBadgeStyle}>
            {STATUS_LABEL[order.status]}
          </span>
          {order.hasShortage && <span className="co-shortage-badge">⚠️ عجز مخزون</span>}
        </td>
        <td style={{ textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
          <div style={{ display: "flex", gap: "0.35rem", justifyContent: "center" }}>
            <button
              className="co-btn co-btn-confirm"
              onClick={() => onStatusChange(order.id, "CONFIRMED")}
              disabled={saving}
            >
              تأكيد الطلب
            </button>
            <button
              className="co-btn co-btn-postpone"
              onClick={() => onStatusChange(order.id, "POSTPONED")}
              disabled={saving}
            >
              تأجيل
            </button>
            <button
              className="co-btn co-btn-noanswer"
              onClick={() => onStatusChange(order.id, "NO_ANSWER")}
              disabled={saving}
            >
              لم يرد
            </button>
            <button className="co-btn co-btn-cancel" onClick={onCancelClick} disabled={saving}>
              إلغاء
            </button>
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
                    {detail?.items.map((item: Order["items"][number]) => (
                      <tr key={item.id}>
                        <td>{item.product.name}</td>
                        <td>{toArabicNumerals(String(item.quantity))}</td>
                        <td>{toArabicNumerals(String(item.confirmedQuantity))}</td>
                        <td>{money(item.unitPrice)} ج.م</td>
                        <td>{money(Number(item.unitPrice) * item.quantity)} ج.م</td>
                        <td>—</td>
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
