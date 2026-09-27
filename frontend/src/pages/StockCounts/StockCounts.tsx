import { Fragment, useCallback, useEffect, useState, type FormEvent } from "react";
import DashboardLayout from "../../components/DashboardLayout/DashboardLayout";
import { toArabicNumerals } from "../../utils/arabicNumerals";
import { inventoryApi, type StockCount, type StockCountStatus, type Warehouse, type StorageLocation } from "../../lib/api";
import "../SystemSettings/SystemSettings.css";

interface StockCountsProps {
  navigate: (path: string) => void;
}

type Notice = { type: "success" | "error"; text: string };

const STATUS_AR: Record<StockCountStatus, string> = {
  DRAFT: "مسودة",
  IN_PROGRESS: "جارٍ الجرد",
  COMPLETED: "مكتمل",
  CANCELLED: "ملغي",
};

export default function StockCounts({ navigate }: StockCountsProps) {
  void navigate;
  const [items, setItems] = useState<StockCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailCache, setDetailCache] = useState<Record<string, StockCount>>({});
  const [counts, setCounts] = useState<Record<string, string>>({});

  const [formOpen, setFormOpen] = useState(false);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [locations, setLocations] = useState<StorageLocation[]>([]);
  const [warehouseId, setWarehouseId] = useState("");
  const [storageLocationId, setStorageLocationId] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [page, wh] = await Promise.all([
        inventoryApi.listStockCounts({ pageSize: 100 }),
        inventoryApi.listWarehouses().catch(() => [] as Warehouse[]),
      ]);
      setItems(page.items);
      setWarehouses(wh);
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "تعذر تحميل الجرد." });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!warehouseId) {
      setLocations([]);
      setStorageLocationId("");
      return;
    }
    inventoryApi
      .listStorageLocations({ warehouseId })
      .then((list) => setLocations(list))
      .catch(() => setLocations([]));
  }, [warehouseId]);

  const toggle = async (count: StockCount) => {
    if (expandedId === count.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(count.id);
    if (detailCache[count.id]) return;
    try {
      const full = await inventoryApi.getStockCount(count.id);
      setDetailCache((prev) => ({ ...prev, [count.id]: full }));
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "تعذر تحميل تفاصيل الجرد." });
    }
  };

  const act = async (id: string, fn: (id: string) => Promise<StockCount>, ok: string) => {
    setSaving(true);
    setNotice(null);
    try {
      const updated = await fn(id);
      setItems((prev) => prev.map((c) => (c.id === id ? updated : c)));
      setDetailCache((prev) => ({ ...prev, [id]: updated }));
      setNotice({ type: "success", text: ok });
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "تعذر تنفيذ العملية." });
    } finally {
      setSaving(false);
    }
  };

  const saveCounts = async (count: StockCount) => {
    const detail = detailCache[count.id];
    if (!detail) return;
    const payload = detail.items
      .filter((it) => (counts[`${count.id}:${it.id}`] ?? "") !== "")
      .map((it) => ({
        productId: it.product.id,
        storageLocationId: it.storageLocation.id,
        countedQuantity: Number(counts[`${count.id}:${it.id}`]),
      }));
    if (payload.length === 0) {
      setNotice({ type: "error", text: "أدخل كمية معدودة لصنف واحد على الأقل." });
      return;
    }
    await act(count.id, (id) => inventoryApi.recordStockCount(id, payload), "تم حفظ الكميات المعدودة.");
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setNotice(null);
    try {
      await inventoryApi.createStockCount({
        warehouseId: warehouseId || null,
        storageLocationId: storageLocationId || null,
        reason: reason.trim() || null,
        notes: notes.trim() || null,
      });
      setFormOpen(false);
      setWarehouseId("");
      setStorageLocationId("");
      setReason("");
      setNotes("");
      setNotice({ type: "success", text: "تم فتح الجرد بنجاح." });
      await load();
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "تعذر فتح الجرد." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <DashboardLayout navigate={navigate}>
      <div className="view-container">
        <div className="ss-page-header">
          <div>
            <p className="ss-page-kicker">المخزون</p>
            <h1 className="ss-page-title">الجرد الفعلي</h1>
            <p className="ss-page-sub">فتح جرد وتسجيل الكميات المعدودة ثم اعتماد الفروقات.</p>
          </div>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button className="io-button io-button-ghost" onClick={() => void load()} disabled={loading}>
              تحديث
            </button>
            <button className="io-button io-button-primary" onClick={() => setFormOpen((o) => !o)}>
              فتح جرد جديد
            </button>
          </div>
        </div>

        {notice && (
          <div style={{ padding: "0.6rem 1rem", marginBottom: "1rem", borderRadius: "8px", fontSize: "0.85rem", background: notice.type === "success" ? "var(--color-success-soft)" : "var(--color-danger-soft)", color: notice.type === "success" ? "var(--color-success)" : "var(--color-danger)" }}>
            {notice.text}
          </div>
        )}

        {formOpen && (
          <form className="ss-editor" onSubmit={submit} style={{ marginBottom: "1rem" }}>
            <div className="ss-editor-field">
              <label htmlFor="count-warehouse">المستودع (اختياري)</label>
              <select id="count-warehouse" className="ss-input" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} disabled={saving}>
                <option value="">كل المستودعات</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            </div>
            <div className="ss-editor-field">
              <label htmlFor="count-location">مكان التخزين (اختياري)</label>
              <select id="count-location" className="ss-input" value={storageLocationId} onChange={(e) => setStorageLocationId(e.target.value)} disabled={saving || !warehouseId}>
                <option value="">كل الأماكن</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
            </div>
            <div className="ss-editor-field">
              <label htmlFor="count-reason">السبب</label>
              <input id="count-reason" className="ss-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="مثال: جرد شهري" disabled={saving} />
            </div>
            <div className="ss-editor-field">
              <label htmlFor="count-notes">ملاحظات</label>
              <input id="count-notes" className="ss-input" value={notes} onChange={(e) => setNotes(e.target.value)} disabled={saving} />
            </div>
            <div className="ss-editor-actions">
              <button className="ss-button ss-button-ghost" type="button" onClick={() => setFormOpen(false)} disabled={saving}>إلغاء</button>
              <button className="ss-button ss-button-primary" type="submit" disabled={saving}>{saving ? "جارٍ الفتح..." : "فتح الجرد"}</button>
            </div>
          </form>
        )}

        <div className="io-data-surface">
          {loading ? (
            <div style={{ padding: "2rem", textAlign: "center", color: "var(--text-secondary)" }}>جارٍ التحميل...</div>
          ) : items.length === 0 ? (
            <div style={{ padding: "2rem", textAlign: "center", color: "var(--text-muted)" }}>لا توجد جردات بعد</div>
          ) : (
            <div className="io-table-scroll">
              <table className="co-items-table">
              <thead>
                <tr>
                  <th>الرقم المرجعي</th>
                  <th>المستودع</th>
                  <th>المكان</th>
                  <th>السبب</th>
                  <th>الحالة</th>
                  <th>الأصناف</th>
                  <th>بدأ في</th>
                  <th>اكتمل في</th>
                  <th>إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {items.map((count) => (
                  <Fragment key={count.id}>
                    <tr>
                      <td>
                        <button
                          type="button"
                          onClick={() => void toggle(count)}
                          style={{ background: "none", border: "none", cursor: "pointer", padding: 0, color: "var(--color-accent)", textDecoration: "underline", fontFamily: "monospace", fontSize: "0.8rem" }}
                        >
                          {count.referenceNumber}
                        </button>
                      </td>
                      <td>{count.warehouse?.name ?? "—"}</td>
                      <td>{count.storageLocation?.name ?? "—"}</td>
                      <td>{count.reason || "—"}</td>
                      <td>
                        <span className="ss-related-badge">{STATUS_AR[count.status] ?? count.status}</span>
                      </td>
                      <td>{toArabicNumerals(String(count.items.length))}</td>
                      <td>{count.startedAt ? new Date(count.startedAt).toLocaleDateString("ar-EG") : "—"}</td>
                      <td>{count.completedAt ? new Date(count.completedAt).toLocaleDateString("ar-EG") : "—"}</td>
                      <td>
                        <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
                          {count.status === "DRAFT" && (
                            <button type="button" className="io-button io-button-ghost" onClick={() => void act(count.id, inventoryApi.startStockCount, "بدأ الجرد.")} disabled={saving}>بدء</button>
                          )}
                          {count.status === "IN_PROGRESS" && (
                            <button type="button" className="io-button io-button-primary" onClick={() => void act(count.id, inventoryApi.completeStockCount, "تم اعتماد الجرد.")} disabled={saving}>اعتماد</button>
                          )}
                          {(count.status === "DRAFT" || count.status === "IN_PROGRESS") && (
                            <button type="button" className="io-button io-button-ghost" onClick={() => void act(count.id, inventoryApi.cancelStockCount, "تم إلغاء الجرد.")} disabled={saving}>إلغاء</button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {expandedId === count.id && (
                      <tr key={`${count.id}-items`}>
                        <td colSpan={9}>
                          {!detailCache[count.id] ? (
                            <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>جارٍ التحميل…</span>
                          ) : detailCache[count.id].items.length === 0 ? (
                            <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>لا أصناف في هذا الجرد</span>
                          ) : (
                            <>
                              <table className="co-items-table">
                                <thead>
                                  <tr>
                                    <th>المنتج</th>
                                    <th>الكود</th>
                                    <th>المكان</th>
                                    <th>كمية النظام</th>
                                    <th>المعدودة</th>
                                    <th>الفرق</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {detailCache[count.id].items.map((it) => (
                                    <tr key={it.id}>
                                      <td>{it.product.name}</td>
                                      <td><span dir="ltr">{it.product.skuCode ?? "—"}</span></td>
                                      <td>{it.storageLocation.name}</td>
                                      <td>{toArabicNumerals(String(it.systemQuantity))}</td>
                                      <td>
                                        {count.status === "IN_PROGRESS" ? (
                                          <input
                                            type="number"
                                            min={0}
                                            className="ss-input"
                                            style={{ width: "90px", direction: "ltr" }}
                                            value={counts[`${count.id}:${it.id}`] ?? (it.countedQuantity ?? "")}
                                            onChange={(e) => setCounts((prev) => ({ ...prev, [`${count.id}:${it.id}`]: e.target.value }))}
                                            disabled={saving}
                                          />
                                        ) : (
                                          it.countedQuantity ?? "—"
                                        )}
                                      </td>
                                      <td>
                                        {it.variance == null ? "—" : (
                                          <strong style={{ color: it.variance === 0 ? "var(--color-success)" : "#b3261e" }}>
                                            {toArabicNumerals(String(it.variance))}
                                          </strong>
                                        )}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                              {count.status === "IN_PROGRESS" && (
                                <div style={{ padding: "0.6rem 0" }}>
                                  <button type="button" className="io-button io-button-primary" onClick={() => void saveCounts(count)} disabled={saving}>
                                    حفظ الكميات المعدودة
                                  </button>
                                </div>
                              )}
                              {detailCache[count.id].notes && (
                                <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)", padding: "0.3rem 0" }}>
                                  ملاحظات: {detailCache[count.id].notes}
                                </div>
                              )}
                            </>
                          )}
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
      </div>
    </DashboardLayout>
  );
}
