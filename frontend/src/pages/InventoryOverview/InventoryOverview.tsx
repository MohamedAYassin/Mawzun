import { useCallback, useEffect, useState } from "react";
import DashboardLayout from "../../components/DashboardLayout/DashboardLayout";
import { toArabicNumerals } from "../../utils/arabicNumerals";
import {
  reportsApi,
  type InventoryOverview as InventoryNumbers,
  type ProductOverview,
  type StockAttention,
  type StockMovements,
} from "../../lib/api/reports";
import { AttentionRow, Kpi, Panel, Skeleton, Trend } from "../Reports/widgets";
import "../../styles/DashboardViews.css";
import "../Reports/widgets.css";

const num = (v: number | undefined) => toArabicNumerals(Math.round(v ?? 0).toLocaleString("en-US"));
const money = (v: number | undefined) => `${toArabicNumerals((v ?? 0).toFixed(2))} ج.م`;
const dayLabel = (iso: string) => {
  const d = new Date(`${iso}T00:00:00`);
  return toArabicNumerals(`${d.getDate()}/${d.getMonth() + 1}`);
};

export default function InventoryOverview({ navigate }: { navigate: (path: string) => void }) {
  const [loading, setLoading] = useState(true);
  const [inv, setInv] = useState<InventoryNumbers | null>(null);
  const [prod, setProd] = useState<ProductOverview | null>(null);
  const [moves, setMoves] = useState<StockMovements | null>(null);
  const [attention, setAttention] = useState<StockAttention | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [i, p, m, a] = await Promise.all([
        reportsApi.inventoryOverview(),
        reportsApi.productOverview(),
        reportsApi.stockMovements({ days: 30 }),
        reportsApi.stockAttention(),
      ]);
      setInv(i);
      setProd(p);
      setMoves(m);
      setAttention(a);
    } catch {
      // Panels render their empty states; the page never blanks.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const fires =
    (attention?.outOfStock.total ?? 0) +
    (attention?.lowStock.total ?? 0) +
    (attention?.openCounts ?? 0) +
    (attention?.pendingOperations ?? 0);

  return (
    <DashboardLayout navigate={navigate}>
      <div className="view-container">
        <div className="view-header cmd-topbar">
          <div>
            <h1 className="view-header-title">قيادة المخزون</h1>
            <p className="view-header-subtitle">
              {fires > 0
                ? `لديك ${toArabicNumerals(fires)} بحاجة إلى متابعة.`
                : "المخزون مستقر. راجع الحركة أدناه."}
            </p>
          </div>
          <button className="btn-filter" onClick={load} disabled={loading}>
            تحديث البيانات
          </button>
        </div>

        {loading ? (
          <Skeleton />
        ) : (
          <>
            <div className="cmd-grid-kpi">
              <Kpi label="قيمة المخزون" value={money(inv?.totalValue)} sub={`${num(inv?.availableQuantity)} قطعة متاحة`} />
              <Kpi label="نفذت تمامًا" value={num(attention?.outOfStock.total)} tone={(attention?.outOfStock.total ?? 0) > 0 ? "bad" : "good"} />
              <Kpi label="أوشكت على النفاد" value={num(attention?.lowStock.total)} tone={(attention?.lowStock.total ?? 0) > 0 ? "warn" : undefined} />
              <Kpi label="شغل مفتوح" value={num((attention?.openCounts ?? 0) + (attention?.pendingOperations ?? 0))} sub="جرد وعمليات" />
            </div>

            <Panel title="حركة آخر ٣٠ يوم" sub="داخل مقابل خارج من دفتر المخزون">
              <Trend
                points={(moves?.points ?? []).map((p) => ({ label: dayLabel(p.date), a: p.in, b: p.out }))}
                legend={["داخل", "خارج"]}
                colors={["#0f9d70", "var(--color-danger)"]}
                formatY={(v) => toArabicNumerals(Math.round(v).toLocaleString("en-US"))}
              />
            </Panel>

            <div className="cmd-grid-2">
              <Panel title="نفذت من المخزن" sub="منتجات بلا أي رصيد — اشترِ أو أنتج">
                {(attention?.outOfStock.items ?? []).length ? (
                  <>
                    <ul className="cmd-att-items">
                      {attention!.outOfStock.items.map((it) => (
                        <li key={it.productId}>
                          <span>{it.name}</span>
                          {it.skuCode ? <span>{it.skuCode}</span> : null}
                        </li>
                      ))}
                    </ul>
                    {attention!.outOfStock.total > attention!.outOfStock.items.length ? (
                      <button className="cmd-more" onClick={() => navigate("/dashboard/low-stock")}>
                        +{num(attention!.outOfStock.total - attention!.outOfStock.items.length)} منتجات أخرى — عرض الكل
                      </button>
                    ) : null}
                  </>
                ) : (
                  <p className="cmd-empty">لا توجد منتجات نافذة.</p>
                )}
              </Panel>
              <Panel title="أوشكت على النفاد" sub="تحت الحد — الرصيد الحالي بين قوسين">
                {(attention?.lowStock.items ?? []).length ? (
                  <>
                    <ul className="cmd-att-items">
                      {attention!.lowStock.items.map((it) => (
                        <li key={it.productId}>
                          <span>{it.name}</span>
                          <span>
                            {num(it.onHand)} / حد {num(it.threshold)}
                          </span>
                        </li>
                      ))}
                    </ul>
                    {attention!.lowStock.total > attention!.lowStock.items.length ? (
                      <button className="cmd-more" onClick={() => navigate("/dashboard/low-stock")}>
                        +{num(attention!.lowStock.total - attention!.lowStock.items.length)} منتجات أخرى — عرض الكل
                      </button>
                    ) : null}
                  </>
                ) : (
                  <p className="cmd-empty">كل المنتجات فوق حدها.</p>
                )}
              </Panel>
            </div>

            <Panel title="شغل مفتوح" sub="جرد وعمليات مستنية حد يقفلها">
              <AttentionRow
                title="جرد مفتوح"
                count={num(attention?.openCounts)}
                sub="عدّات لم تُعتمد بعد"
                to="/dashboard/stock-counts"
                navigate={navigate}
                tone={(attention?.openCounts ?? 0) > 0 ? "warn" : undefined}
              />
              <AttentionRow
                title="عمليات مخزون معلقة"
                count={num(attention?.pendingOperations)}
                sub="مسودات وجاهزة للتنفيذ"
                to="/dashboard/stock-operations"
                navigate={navigate}
              />
              <AttentionRow
                title="إجمالي المنتجات النشطة"
                count={num(prod?.activeProducts)}
                sub={`من ${num(prod?.totalProducts)} منتج`}
                to="/dashboard/products"
                navigate={navigate}
              />
            </Panel>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
