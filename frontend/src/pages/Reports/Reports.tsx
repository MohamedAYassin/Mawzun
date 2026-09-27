import { useCallback, useEffect, useState } from "react";
import DashboardLayout from "../../components/DashboardLayout/DashboardLayout";
import { usePathname } from "../../lib/navigation";
import { reportsApi, type LocationStockRow, type StockReportRow } from "../../lib/api";
import { toArabicNumerals } from "../../utils/arabicNumerals";
import {
  ModuleHeading,
  StatusBanner,
  LoadingState,
  EmptyState,
  Button,
  BoxIcon,
  MapPinIcon,
  type Notice,
} from "../shared/ManagementUi";
import "../SystemSettings/SystemSettings.css";

interface ReportsProps {
  navigate: (path: string) => void;
}

function formatQty(value: number): string {
  return value.toLocaleString("ar-EG", { maximumFractionDigits: 2 });
}

/** Money with two decimals, grouped — matches the other report screens. */
function fmtMoney(value: number): string {
  return value.toLocaleString("ar-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function ReportsView({ navigate }: { navigate: (path: string) => void }) {
  // The tab is DERIVED from the path, not stored. It used to be a useState
  // seeded once from usePathname(), which desynced on browser Back: the URL
  // returned to /dashboard/reports but the state kept "locations", so the page
  // showed the empty locations view under the stock URL until the user clicked
  // the tab again.
  const pathname = usePathname().toLowerCase();
  const tab: "stock" | "locations" = pathname.includes("locations") ? "locations" : "stock";
  const [stock, setStock] = useState<StockReportRow[]>([]);
  const [locations, setLocations] = useState<LocationStockRow[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [totalEntries, setTotalEntries] = useState(0);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [lastLoaded, setLastLoaded] = useState<Date | null>(null);

  const load = useCallback(async (showLoader = true, currentPage = page, which: "stock" | "locations" = tab) => {
    if (showLoader) setLoading(true);
    try {
      // Paged rather than pulled in one go: this report covers every product in
      // every storage location, so the row count grows with the catalogue and
      // is not bounded by anything the page can assume.
      //
      // Two shapes over the same stock_levels data: per product-per-bin, and
      // rolled up by storage location.
      if (which === "locations") {
        const locPage = await reportsApi.stockByLocation({ page: currentPage, pageSize: 10 });
        setLocations(locPage.items);
        setTotalPages(locPage.totalPages);
        setTotalEntries(locPage.total);
      } else {
        const stockPage = await reportsApi.stockReport({ page: currentPage, pageSize: 10 });
        setStock(stockPage.items);
        setTotalPages(stockPage.totalPages);
        setTotalEntries(stockPage.total);
      }
      setLastLoaded(new Date());
    } catch (error) {
      setNotice({
        type: "error",
        text: error instanceof Error ? error.message : "تعذر تحميل التقارير.",
      });
    } finally {
      setLoading(false);
    }
  }, [page, tab]);

  useEffect(() => {
    void load();
  }, [load]);

  const goToPage = (next: number) => {
    // Only the state changes here: `load` depends on `page`, so the effect
    // above refetches once. Calling load() directly as well would issue the
    // same request twice.
    setPage(next);
  };

  const switchTab = (next: "stock" | "locations") => {
    // No setState for the tab: it is derived from the path, so navigating IS
    // the switch. Setting it as well would fight the URL on the next Back.
    // The page DOES reset — the two reports have different lengths, so staying
    // on page 4 of the stock report could land on an empty locations page.
    setPage(1);
    const path = next === "locations" ? "/dashboard/reports/locations" : "/dashboard/reports/stock";
    navigate(path);
  };

  return (
    <section className="ss-module animate-fade-in">
      <ModuleHeading
        icon={<BoxIcon />}
        eyebrow="التقارير"
        title="تقارير المخازن (Reports)"
        subtitle="تقرير المخزون الإجمالي لكل منتج وتوزيع الكميات على مواقع التخزين."
      />
      <div className="ss-module-actions">
        <span className="ss-count-chip">
          <strong>{toArabicNumerals(totalEntries)}</strong> صف
        </span>
        <Button variant="ghost" onClick={() => void load()} disabled={loading}>
          تحديث
        </Button>
      </div>
      <StatusBanner notice={notice} />
      <div className="ss-list-toolbar" style={{ gap: "0.5rem" }}>
        <Button variant={tab === "stock" ? "primary" : "ghost"} onClick={() => switchTab("stock")}>
          <BoxIcon size={16} /> تقرير المخزون
        </Button>
        <Button
          variant={tab === "locations" ? "primary" : "ghost"}
          onClick={() => switchTab("locations")}
        >
          <MapPinIcon size={16} /> تقرير المواقع
        </Button>
        <span className="ss-last-loaded">
          {lastLoaded
            ? `آخر تحديث ${lastLoaded.toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" })}`
            : ""}
        </span>
      </div>
      <div className="ss-data-surface">
        {loading ? (
          <LoadingState />
        ) : tab === "stock" ? (
          stock.length === 0 ? (
            <EmptyState hasSearch={false} />
          ) : (
            <div className="ss-table-scroll">
              <table className="ss-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>المنتج</th>
                    <th>SKU</th>
                    <th>إجمالي المتاح</th>
                    <th>الحد الأدنى</th>
                    <th>الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {stock.map((row, index) => (
                    <tr key={row.id}>
                      <td>
                        <span className="ss-row-number">
                          {toArabicNumerals((page - 1) * 10 + index + 1)}
                        </span>
                      </td>
                      <td>
                        <span className="ss-item-name">{row.productName}</span>
                      </td>
                      <td>
                        <span dir="ltr">{row.skuCode || "—"}</span>
                      </td>
                      <td>
                        <span>{formatQty(row.quantityOnHand)}</span>
                      </td>
                      <td>
                        <span>—</span>
                      </td>
                      <td>
                        <span
                          className="ss-related-badge"
                          style={
                            row.quantityOnHand === 0
                              ? { background: "var(--color-danger-soft)", color: "var(--color-danger)" }
                              : { background: "var(--color-success-soft)", color: "var(--color-success)" }
                          }
                        >
                          {row.quantityOnHand === 0 ? "نفذ" : "متوفر"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : locations.length === 0 ? (
          <EmptyState hasSearch={false} />
        ) : (
          <div className="ss-table-scroll">
            <table className="ss-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>الموقع</th>
                  <th>الكود</th>
                  <th>المخزن</th>
                  <th>عدد الأصناف</th>
                  <th>الكمية</th>
                  <th>المتاح</th>
                  <th>إجمالي التكلفة</th>
                </tr>
              </thead>
              <tbody>
                {locations.map((row, index) => (
                  <tr key={row.locationId}>
                    <td>
                      <span className="ss-row-number">
                        {toArabicNumerals((page - 1) * 10 + index + 1)}
                      </span>
                    </td>
                    <td>
                      <span className="ss-item-name">{row.locationName}</span>
                    </td>
                    <td>
                      <span dir="ltr">{row.locationCode || "—"}</span>
                    </td>
                    <td>
                      <span>{row.warehouseName}</span>
                    </td>
                    <td>
                      <span>{toArabicNumerals(String(row.productCount))}</span>
                    </td>
                    <td>
                      <span>{formatQty(row.quantityOnHand)}</span>
                    </td>
                    <td>
                      <span>{formatQty(row.availableQuantity)}</span>
                    </td>
                    <td>
                      <span dir="ltr">{fmtMoney(row.totalCost)} ج.م</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {totalPages > 1 && (
        <div className="ss-list-toolbar" style={{ justifyContent: "center" }}>
          <Button variant="ghost" onClick={() => goToPage(page - 1)} disabled={page <= 1 || loading}>
            السابق
          </Button>
          <span className="ss-count-chip">
            صفحة {toArabicNumerals(page)} من {toArabicNumerals(totalPages)}
          </span>
          <Button
            variant="ghost"
            onClick={() => goToPage(page + 1)}
            disabled={page >= totalPages || loading}
          >
            التالي
          </Button>
        </div>
      )}
    </section>
  );
}

export default function Reports({ navigate }: ReportsProps) {
  return (
    <DashboardLayout navigate={navigate}>
      <div className="view-container">
        <ReportsView navigate={navigate} />
      </div>
    </DashboardLayout>
  );
}
