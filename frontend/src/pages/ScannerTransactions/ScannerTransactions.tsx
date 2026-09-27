import { useCallback, useEffect, useState } from "react";
import { inventoryApi, type InventoryTransaction, type StorageLocation } from "../../lib/api";
import { toArabicNumerals } from "../../utils/arabicNumerals";
import DashboardLayout from "../../components/DashboardLayout/DashboardLayout";
import { Select } from "../../components/Select/Select";
import "../../styles/DashboardViews.css";
import "./ScannerTransactions.css";

type Notice = {
  type: "success" | "error" | "info";
  text: string;
};

// This screen is a window onto the movement ledger, not onto a
// bulk-transaction table — no such table exists. Every scanner run reaches the
// server as one counted adjustment per line, so what is listed here are the
// resulting InventoryTransaction rows.
//
// Two consequences worth knowing before changing the filters:
//
//   - the endpoint filters by product, storage location, warehouse and a text
//     search over referenceNumber/reason. It has *no* transaction-type filter,
//     so a type dropdown would only ever filter the page already fetched and
//     would quietly hide rows. It is deliberately absent.
//   - `quantity` is signed (the engine adds it to the running level) and the
//     direction is encoded in the type as well, so the two always agree. The
//     sign is what feeds the balance; the type is what gets displayed.

const INCOMING_TYPES = new Set([
  "OPENING",
  "PURCHASE",
  "RETURN_IN",
  "TRANSFER_IN",
  "ADJUSTMENT_IN",
  "PRODUCTION_IN",
]);

const TYPE_LABELS: Record<string, string> = {
  OPENING: "رصيد افتتاحي",
  PURCHASE: "شراء",
  SALE: "بيع",
  RETURN_IN: "مرتجع وارد",
  RETURN_OUT: "مرتجع صادر",
  TRANSFER_IN: "تحويل وارد",
  TRANSFER_OUT: "تحويل صادر",
  ADJUSTMENT_IN: "تسوية بالزيادة",
  ADJUSTMENT_OUT: "تسوية بالنقص",
  PRODUCTION_IN: "إنتاج وارد",
  PRODUCTION_OUT: "إنتاج صادر",
  SCRAP: "إعدام",
};

function getTypeName(type: string) {
  return TYPE_LABELS[type] ?? type;
}

function isIncoming(entry: InventoryTransaction) {
  return INCOMING_TYPES.has(entry.transactionType);
}

function formatDate(value: string) {
  return new Date(value).toLocaleString("ar-EG", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function StatusBanner({ notice }: { notice: Notice | null }) {
  if (!notice) return null;
  const className =
    notice.type === "success"
      ? "st-banner st-banner-success"
      : notice.type === "error"
        ? "st-banner st-banner-error"
        : "st-banner st-banner-info";
  return (
    <div className={className}>
      <span style={{ fontSize: "1rem" }}>
        {notice.type === "success" ? "✓" : notice.type === "error" ? "✕" : "ℹ"}
      </span>
      <span>{notice.text}</span>
    </div>
  );
}

function RefreshIcon() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ marginLeft: "4px" }}
    >
      <path d="M20 11a8.1 8.1 0 0 0-14.8-4L3 10" />
      <path d="M3 5v5h5" />
      <path d="M4 13a8.1 8.1 0 0 0 14.8 4L21 14" />
      <path d="M21 19v-5h-5" />
    </svg>
  );
}

export default function ScannerTransactions({ navigate }: { navigate: (path: string) => void }) {
  const [entries, setEntries] = useState<InventoryTransaction[]>([]);
  const [locations, setLocations] = useState<StorageLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<Notice | null>(null);

  const [search, setSearch] = useState("");
  const [locationId, setLocationId] = useState("");

  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [total, setTotal] = useState(0);
  const pageSize = 10;

  // The row already carries everything a detail view could show, and the API
  // has no single-transaction endpoint, so opening one is a local state change
  // rather than a fetch.
  const [detail, setDetail] = useState<InventoryTransaction | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await inventoryApi.listStockTransactions({
        search: search || undefined,
        storageLocationId: locationId || undefined,
        page,
        pageSize,
      });
      setEntries(result.items);
      setTotalPages(result.totalPages);
      setTotal(result.total);
    } catch (error) {
      setNotice({
        type: "error",
        text: error instanceof Error ? error.message : "تعذر تحميل سجل المسح.",
      });
    } finally {
      setLoading(false);
    }
  }, [search, locationId, page, pageSize]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    inventoryApi
      .listStorageLocations()
      .then(setLocations)
      .catch(() => setLocations([]));
  }, []);

  const locationOptions = [
    { value: "", label: "كل المواقع" },
    ...locations.map((l) => ({ value: l.id, label: l.name })),
  ];

  return (
    <DashboardLayout navigate={navigate}>
      <div className="view-container">
        <div className="view-header" style={{ marginBottom: "0.2rem" }}>
          <div>
            <h1 className="view-header-title">سجل المسح</h1>
            <p className="view-header-subtitle">
              حركات المخزون الناتجة عن عمليات المسح والجرد، كما سجلها دفتر الحركات.
            </p>
          </div>
        </div>

        <div className="st-data-surface">
          <div className="st-surface-header">
            <span className="st-surface-title">حركات المخزون</span>
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
              <span className="st-badge st-badge-user">{toArabicNumerals(total)} حركة</span>
              <button
                type="button"
                className="io-button io-button-secondary"
                onClick={() => void load()}
                disabled={loading}
                style={{
                  padding: "0.35rem 0.75rem",
                  minHeight: "auto",
                  display: "flex",
                  alignItems: "center",
                }}
              >
                <RefreshIcon />
                <span>تحديث</span>
              </button>
            </div>
          </div>

          <div className="st-filter-bar">
            <div className="st-filter-search">
              <input
                type="text"
                placeholder="ابحث برقم المرجع أو السبب..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
              />
            </div>
            <div className="st-filter-select-wrapper">
              <Select
                value={locationId}
                onChange={(val) => {
                  setLocationId(String(val ?? ""));
                  setPage(1);
                }}
                options={locationOptions}
              />
            </div>
          </div>

          <StatusBanner notice={notice} />

          {loading ? (
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                minHeight: "180px",
                color: "var(--text-secondary)",
                fontSize: "0.85rem",
              }}
            >
              جاري التحميل...
            </div>
          ) : entries.length === 0 ? (
            <div className="st-empty">
              <h3>لا توجد حركات</h3>
              <p>
                {search || locationId
                  ? "لا توجد نتائج تطابق معايير البحث."
                  : "لم يتم تسجيل أي حركات مخزون بعد."}
              </p>
            </div>
          ) : (
            <>
              <div className="st-table-container">
                <table className="st-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>المنتج</th>
                      <th>كود المنتج</th>
                      <th>نوع الحركة</th>
                      <th>الكمية</th>
                      <th>الرصيد بعد</th>
                      <th>موقع التخزين</th>
                      <th>المستخدم</th>
                      <th>التاريخ والوقت</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((item, index) => (
                      <tr
                        key={item.id}
                        style={{ cursor: "pointer" }}
                        onClick={() => setDetail(item)}
                      >
                        <td>
                          <span className="st-row-num">{(page - 1) * pageSize + index + 1}</span>
                        </td>
                        <td>
                          <strong style={{ color: "var(--text-primary)" }}>
                            {item.product.name}
                          </strong>
                        </td>
                        <td>
                          <span className="st-ref-code">{item.product.skuCode ?? "—"}</span>
                        </td>
                        <td>
                          <span
                            className={`st-badge ${
                              isIncoming(item) ? "st-badge-incoming" : "st-badge-outgoing"
                            }`}
                          >
                            {getTypeName(item.transactionType)}
                          </span>
                        </td>
                        <td>
                          <strong style={{ fontSize: "0.85rem" }}>
                            {isIncoming(item) ? "+" : "−"}
                            {toArabicNumerals(Math.abs(item.quantity))}
                          </strong>
                        </td>
                        <td>
                          <strong style={{ fontSize: "0.85rem" }}>
                            {toArabicNumerals(item.balanceAfter)}
                          </strong>
                        </td>
                        <td>
                          <span className="st-badge-location">{item.storageLocation.name}</span>
                        </td>
                        <td>
                          <span className="st-badge st-badge-user">
                            {item.actor?.fullName ?? "النظام"}
                          </span>
                        </td>
                        <td>
                          <span>{formatDate(item.createdAt)}</span>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="io-button io-button-secondary"
                            style={{
                              fontSize: "0.75rem",
                              padding: "0.25rem 0.6rem",
                              minHeight: "auto",
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              setDetail(item);
                            }}
                          >
                            التفاصيل
                          </button>
                        </td>
                      </tr>
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
                    gap: "0.75rem",
                    padding: "1rem",
                    borderTop: "1px solid var(--border-color)",
                    background: "var(--bg-secondary)",
                  }}
                >
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    className="io-button io-button-secondary"
                    style={{
                      minHeight: "auto",
                      padding: "0.35rem 0.8rem",
                      opacity: page <= 1 ? 0.4 : 1,
                      cursor: page <= 1 ? "default" : "pointer",
                    }}
                  >
                    السابق
                  </button>
                  <span
                    style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text-secondary)" }}
                  >
                    الصفحة {toArabicNumerals(page)} من {toArabicNumerals(totalPages)}
                  </span>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                    className="io-button io-button-secondary"
                    style={{
                      minHeight: "auto",
                      padding: "0.35rem 0.8rem",
                      opacity: page >= totalPages ? 0.4 : 1,
                      cursor: page >= totalPages ? "default" : "pointer",
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

      {detail && (
        <div className="st-modal-overlay" onClick={() => setDetail(null)}>
          <div className="st-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="st-modal-header">
              <div>
                <h3 className="st-modal-title">{detail.product.name}</h3>
                <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
                  <span
                    className={`st-badge ${
                      isIncoming(detail) ? "st-badge-incoming" : "st-badge-outgoing"
                    }`}
                  >
                    {getTypeName(detail.transactionType)}
                  </span>
                  <span className="st-badge st-badge-user">
                    {isIncoming(detail) ? "+" : "−"}
                    {toArabicNumerals(Math.abs(detail.quantity))}
                  </span>
                </div>
              </div>
              <button
                className="io-button io-button-secondary"
                style={{ fontSize: "0.8rem", padding: "0.35rem 0.75rem", minHeight: "auto" }}
                onClick={() => setDetail(null)}
              >
                إغلاق
              </button>
            </div>

            <div className="st-modal-meta-grid">
              <div className="st-meta-item">
                <span>التاريخ والوقت</span>
                <strong>{formatDate(detail.createdAt)}</strong>
              </div>
              <div className="st-meta-item">
                <span>كود المنتج</span>
                <strong>{detail.product.skuCode ?? "—"}</strong>
              </div>
              <div className="st-meta-item">
                <span>موقع التخزين</span>
                <strong>{detail.storageLocation.name}</strong>
              </div>
              <div className="st-meta-item">
                <span>المخزن</span>
                <strong>{detail.storageLocation.warehouse.name}</strong>
              </div>
              <div className="st-meta-item">
                <span>الرصيد بعد الحركة</span>
                <strong>{toArabicNumerals(detail.balanceAfter)}</strong>
              </div>
              <div className="st-meta-item">
                <span>تكلفة الوحدة</span>
                <strong>
                  {detail.unitCost === null ? "—" : toArabicNumerals(Number(detail.unitCost))}
                </strong>
              </div>
              <div className="st-meta-item">
                <span>المستخدم المسؤول</span>
                <strong>{detail.actor?.fullName ?? "النظام"}</strong>
              </div>
              <div className="st-meta-item">
                <span>رقم المرجع</span>
                <strong>{detail.referenceNumber ?? "—"}</strong>
              </div>
              {detail.reason && (
                <div className="st-meta-item" style={{ gridColumn: "1 / -1" }}>
                  <span>سبب الحركة</span>
                  <strong>{detail.reason}</strong>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
