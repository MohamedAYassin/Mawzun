import { useState, useEffect, useCallback } from "react";
import DashboardLayout from "../../components/DashboardLayout/DashboardLayout";
import { toArabicNumerals } from "../../utils/arabicNumerals";
import {
  reportsApi,
  type OrdersAttention,
  type OrderTotals,
  type OrderGraph,
  type StatusDistribution,
  type TopProduct,
  type TopReturnReason,
  type ConfirmedOrdersStats,
} from "../../lib/api/reports";
import type { OrderStatus } from "../../lib/api/sales";
import { AttentionRow, HBars, Kpi, Panel, RangePills, Skeleton, Trend } from "../Reports/widgets";
import "../../styles/DashboardViews.css";
import "../Reports/widgets.css";

interface SalesOverviewProps {
  navigate: (path: string) => void;
}

const STATUS_AR: Record<OrderStatus, string> = {
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

const STATUS_TONE: Partial<Record<OrderStatus, string>> = {
  DELIVERED: "#0f9d70",
  CANCELLED: "var(--color-danger)",
  RETURNED: "var(--color-danger)",
  NOT_DELIVERED: "#b45309",
  NO_ANSWER: "#b45309",
  ON_THE_WAY: "#0ea5e9",
  CONFIRMED: "#3b82f6",
  NEW: "#8b5cf6",
};

const num = (v: number | undefined) => toArabicNumerals(Math.round(v ?? 0).toLocaleString("en-US"));
const money = (v: number | undefined) => `${toArabicNumerals((v ?? 0).toFixed(2))} ج.م`;
const dayLabel = (iso: string) => {
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
  return toArabicNumerals(`${d.getDate()}/${d.getMonth() + 1}`);
};
const ageOf = (iso: string | null) => {
  if (!iso) return "";
  const days = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000));
  return days === 0 ? "من اليوم" : `أقدم طلب منذ ${toArabicNumerals(days)} ${days === 1 ? "يوم" : "أيام"}`;
};

export default function SalesOverview({ navigate }: SalesOverviewProps) {
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [totals, setTotals] = useState<OrderTotals | null>(null);
  const [graph, setGraph] = useState<OrderGraph | null>(null);
  const [dist, setDist] = useState<StatusDistribution | null>(null);
  const [top, setTop] = useState<TopProduct[]>([]);
  const [reasons, setReasons] = useState<{ reasons: TopReturnReason[] }>({ reasons: [] });
  const [confirmed, setConfirmed] = useState<ConfirmedOrdersStats | null>(null);
  const [attention, setAttention] = useState<OrdersAttention | null>(null);

  const load = useCallback(async (rangeDays: number) => {
    setLoading(true);
    try {
      const to = new Date();
      const from = new Date(Date.now() - (rangeDays - 1) * 86_400_000);
      const q = { from: from.toISOString(), to: to.toISOString() };
      const [t, g, d, tp, tr, c, a] = await Promise.all([
        reportsApi.orderTotals(q),
        reportsApi.orderGraph(q),
        reportsApi.statusDistribution(q),
        reportsApi.topProducts({ ...q, top: 6 }),
        reportsApi.topReturnReasons({ ...q, top: 5 }),
        reportsApi.confirmedOrdersStats(q),
        reportsApi.ordersAttention(),
      ]);
      setTotals(t);
      setGraph(g);
      setDist(d);
      setTop(tp.products);
      setReasons({ reasons: tr.reasons });
      setConfirmed(c);
      setAttention(a);
    } catch {
      // Panels render their empty states; the page never blanks.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(days);
  }, [days, load]);

  const needsWork =
    (attention?.newOrders.count ?? 0) +
    (attention?.noAnswer.count ?? 0) +
    (attention?.postponed.count ?? 0) +
    (attention?.stuckOnTheWay.count ?? 0);

  return (
    <DashboardLayout navigate={navigate}>
      <div className="view-container">
        <div className="view-header cmd-topbar">
          <div>
            <h1 className="view-header-title">قيادة المبيعات</h1>
            <p className="view-header-subtitle">
              {needsWork > 0
                ? `لديك ${toArabicNumerals(needsWork)} بحاجة إلى متابعة.`
                : "جميع الطلبات متتابعة. راجع الاتجاهات أدناه."}
            </p>
          </div>
          <RangePills days={days} onChange={setDays} />
        </div>

        {loading ? (
          <Skeleton />
        ) : (
          <>
            <div className="cmd-grid-kpi">
              <Kpi label="صافي الإيراد" value={money(totals?.netRevenue)} sub={`مرتجعات ${money(totals?.totalReturnedAmount)}`} />
              <Kpi label="الطلبات" value={num(totals?.orderCount)} sub={`متوسط الطلب ${money(totals?.averageOrderPrice)}`} />
              <Kpi
                label="نسبة التسليم"
                value={`٪${toArabicNumerals(Math.round(confirmed?.deliveryPercentage ?? 0))}`}
                sub={`${num(confirmed?.deliveredCount)} طلب تم تسليمه`}
                tone={(confirmed?.deliveryPercentage ?? 100) < 70 ? "warn" : "good"}
              />
              <Kpi label="قيمة الجديد غير المؤكد" value={money(attention?.newOrders.value)} sub={`${num(attention?.newOrders.count)} طلب جديد`} />
            </div>

            <div className="cmd-grid-2">
              <Panel title="إيراد الفترة" sub="صافي المبيعات يوم بيوم">
                <Trend
                  points={(graph?.points ?? []).map((p) => ({ label: dayLabel(p.date), a: p.value }))}
                  legend={["الإيراد"]}
                  colors={["#3b82f6"]}
                  formatY={money}
                />
              </Panel>
              <Panel title="حالات الطلبات" sub="توزيع الفترة الحالية">
                <HBars
                  rows={(dist?.statuses ?? []).map((s) => ({
                    label: STATUS_AR[s.status] ?? s.status,
                    value: s.count,
                    display: `${num(s.count)} · ٪${toArabicNumerals(Math.round(s.percentage))}`,
                    tone: STATUS_TONE[s.status],
                  }))}
                />
              </Panel>
            </div>

            <Panel title="بحاجة إلى انتباه" sub="طلبات متوقفة على تدخل بشري">
              <AttentionRow
                title="طلبات جديدة لم تُؤكد"
                count={num(attention?.newOrders.count)}
                sub={`${money(attention?.newOrders.value)} · ${ageOf(attention?.newOrders.oldestCreatedAt ?? null)}`}
                to="/dashboard/orders"
                navigate={navigate}
                tone={(attention?.newOrders.count ?? 0) > 0 ? "warn" : undefined}
              />
              <AttentionRow
                title="لا يرد على الاتصال"
                count={num(attention?.noAnswer.count)}
                sub="بحاجة إلى محاولة تواصل أخرى"
                to="/dashboard/orders"
                navigate={navigate}
              />
              <AttentionRow
                title="طلبات مؤجلة"
                count={num(attention?.postponed.count)}
                sub="راجعها قبل ما تبرد"
                to="/dashboard/orders"
                navigate={navigate}
              />
              <AttentionRow
                title="عالقة في الطريق"
                count={num(attention?.stuckOnTheWay.count)}
                sub={`مشحونة منذ أكثر من ${toArabicNumerals(attention?.stuckOnTheWay.olderThanDays ?? 7)} أيام`}
                to="/dashboard/orders"
                navigate={navigate}
                tone={(attention?.stuckOnTheWay.count ?? 0) > 0 ? "bad" : undefined}
              />
            </Panel>

            <div className="cmd-grid-2">
              <Panel title="الأعلى مبيعًا" sub="بالكمية والإيراد وصافي الربح">
                {top.length ? (
                  <table className="cmd-table">
                    <thead>
                      <tr>
                        <th>المنتج</th>
                        <th>الكمية</th>
                        <th>الإيراد</th>
                        <th>الربح</th>
                      </tr>
                    </thead>
                    <tbody>
                      {top.map((p) => (
                        <tr key={p.productId ?? p.productName ?? ""}>
                          <td>{p.productName ?? "—"}</td>
                          <td>{num(p.totalQuantity)}</td>
                          <td>{money(p.revenue)}</td>
                          <td>{money(p.grossProfit)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="cmd-empty">لا توجد مبيعات في هذا النطاق.</p>
                )}
              </Panel>
              <Panel title="أسباب الارتجاع" sub="أين موضع التسريب؟">
                <HBars
                  rows={reasons.reasons.map((r) => ({
                    label: r.reasonName ?? "بدون سبب",
                    value: r.count,
                    display: `${num(r.count)} · ٪${toArabicNumerals(Math.round(r.percentage))}`,
                    tone: "var(--color-danger)",
                  }))}
                />
              </Panel>
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
