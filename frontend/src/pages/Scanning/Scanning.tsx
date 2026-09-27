import { useEffect, useRef, useState } from "react";
import {
  inventoryApi,
  catalogApi,
  type ProductListItem,
  type StorageLocation,
} from "../../lib/api";
import { toArabicNumerals } from "../../utils/arabicNumerals";
import { Select } from "../../components/Select/Select";
import "./Scanning.css";

interface ScanningProps {
  navigate: (path: string) => void;
}

interface Line {
  product: ProductListItem;
  qty: number;
}

interface SkuMapping {
  custom: string;
  system: string;
}

const PAGE_SIZE = 10;

const GearIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
  </svg>
);

function getEnglishCharFromEvent(e: KeyboardEvent): string | null {
  // 1. Primary path: Use layout-independent KeyboardEvent.code if supported
  if (e.code) {
    if (e.code.startsWith("Digit")) {
      return e.code.charAt(5); // e.g. "Digit3" -> "3"
    }
    if (
      e.code.startsWith("Numpad") &&
      e.code.length === 7 &&
      e.code.charAt(6) >= "0" &&
      e.code.charAt(6) <= "9"
    ) {
      return e.code.charAt(6); // e.g. "Numpad5" -> "5"
    }
    if (e.code.startsWith("Key")) {
      const letter = e.code.charAt(3).toLowerCase(); // e.g. "KeyA" -> "a"
      return e.shiftKey ? letter.toUpperCase() : letter;
    }
    switch (e.code) {
      case "Minus":
        return e.shiftKey ? "_" : "-";
      case "Slash":
        return e.shiftKey ? "?" : "/";
      case "Period":
        return e.shiftKey ? ">" : ".";
      case "Comma":
        return e.shiftKey ? "<" : ",";
      case "Equal":
        return e.shiftKey ? "+" : "=";
      case "Semicolon":
        return e.shiftKey ? ":" : ";";
      case "Quote":
        return e.shiftKey ? '"' : "'";
      case "BracketLeft":
        return e.shiftKey ? "{" : "[";
      case "BracketRight":
        return e.shiftKey ? "}" : "]";
      case "Backslash":
        return e.shiftKey ? "|" : "\\";
      case "Backquote":
        return e.shiftKey ? "~" : "`";
      case "NumpadSubtract":
        return "-";
      case "NumpadAdd":
        return "+";
      case "NumpadDecimal":
        return ".";
      case "NumpadDivide":
        return "/";
      case "NumpadMultiply":
        return "*";
      case "Space":
        return " ";
    }
  }

  // 2. Fallback path for very old browsers (IE 11, etc.) where e.code is undefined
  if (e.key && e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
    const char = e.key;
    const arabicToEnglishMap: { [key: string]: string } = {
      "٠": "0",
      "١": "1",
      "٢": "2",
      "٣": "3",
      "٤": "4",
      "٥": "5",
      "٦": "6",
      "٧": "7",
      "٨": "8",
      "٩": "9",
    };
    if (arabicToEnglishMap[char] !== undefined) {
      return arabicToEnglishMap[char];
    }
    const arabicKeyboardMap: { [key: string]: string } = {
      ض: "q",
      ص: "w",
      ث: "e",
      ق: "r",
      ف: "t",
      غ: "y",
      ع: "u",
      ه: "i",
      خ: "o",
      ح: "p",
      ج: "[",
      د: "]",
      ش: "a",
      س: "s",
      ي: "d",
      ب: "f",
      ل: "g",
      ا: "h",
      ت: "j",
      ن: "k",
      م: "l",
      ك: ";",
      ط: "'",
      ئ: "z",
      ء: "x",
      ؤ: "c",
      ر: "v",
      لا: "b",
      ى: "n",
      ة: "m",
      و: ",",
      ز: ".",
      ظ: "/",
    };
    if (arabicKeyboardMap[char] !== undefined) {
      const mapped = arabicKeyboardMap[char];
      return e.shiftKey ? mapped.toUpperCase() : mapped;
    }
    return char;
  }
  return null;
}

export default function Scanning({ navigate }: ScanningProps) {
  const [live, setLive] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [page, setPage] = useState(1);
  const [mappings, setMappings] = useState<SkuMapping[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [customSku, setCustomSku] = useState("");
  const [systemSku, setSystemSku] = useState("");
  const [mappingMsg, setMappingMsg] = useState("");
  const [pickerSearch, setPickerSearch] = useState("");
  const [pickerPage, setPickerPage] = useState(1);
  const [locations, setLocations] = useState<StorageLocation[]>([]);
  const [showBulkConfirm, setShowBulkConfirm] = useState(false);
  const [bulkType, setBulkType] = useState<"IN" | "OUT">("IN");
  const [bulkLocationId, setBulkLocationId] = useState("");
  const [bulkSubmitting, setBulkSubmitting] = useState(false);
  const [bulkError, setBulkError] = useState("");
  const [bulkNotice, setBulkNotice] = useState("");
  const mappingsRef = useRef(mappings);

  useEffect(() => {
    mappingsRef.current = mappings;
  }, [mappings]);

  const isMobileUA = /Android|iPhone|iPad|iPod|Mobile|Windows Phone/i.test(navigator.userAgent);
  const [isWide, setIsWide] = useState(() => window.innerWidth >= 768);
  const isDesktop = !isMobileUA && isWide;

  const burstRef = useRef<string[]>([]);
  const pendingRef = useRef(false);
  const pendingTimerRef = useRef<number | null>(null);
  const productsRef = useRef<ProductListItem[]>([]);
  const scannerInputRef = useRef<HTMLInputElement>(null);
  const settingsOpenRef = useRef(false);
  const bulkOpenRef = useRef(false);

  useEffect(() => {
    settingsOpenRef.current = showSettings;
  }, [showSettings]);

  useEffect(() => {
    bulkOpenRef.current = showBulkConfirm;
  }, [showBulkConfirm]);

  const focusScanner = () => {
    window.setTimeout(() => scannerInputRef.current?.focus(), 0);
  };

  const clearPending = () => {
    pendingRef.current = false;
    burstRef.current = [];
    setLive("");
  };

  useEffect(() => {
    focusScanner();
  }, []);

  useEffect(() => {
    const onResize = () => setIsWide(window.innerWidth >= 768);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    Promise.all([
      catalogApi.listProducts({ pageSize: 200 }).catch(() => ({ items: [] as ProductListItem[] })),
      inventoryApi.listStorageLocations().catch(() => [] as StorageLocation[]),
    ])
      .then(([productPage, locData]) => {
        productsRef.current = productPage.items;
        setLocations(locData);
        if (locData[0]) setBulkLocationId(locData[0].id);
        setLoading(false);
      })
      .catch(() => {
        setError("فشل تحميل المنتجات.");
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (settingsOpenRef.current || bulkOpenRef.current) return;
      if (e.key === "Enter") {
        e.preventDefault();
        const text = burstRef.current.join("").trim();
        if (pendingTimerRef.current !== null) {
          window.clearTimeout(pendingTimerRef.current);
          pendingTimerRef.current = null;
        }
        burstRef.current = [];
        setLive("");
        if (!pendingRef.current) return;
        pendingRef.current = false;
        if (!text) return;
        setMessage("");

        const code = text.toLowerCase();
        let found = productsRef.current.find(
          (p) =>
            (p.barcode || "").toLowerCase() === code || (p.skuCode || "").toLowerCase() === code,
        );

        if (!found) {
          const mapping = mappingsRef.current.find((m) => m.custom.toLowerCase() === code);
          if (mapping) {
            found = productsRef.current.find(
              (p) => (p.skuCode || "").toLowerCase() === mapping.system.toLowerCase(),
            );
          }
        }

        if (!found) {
          setMessage("المنتج غير موجود في النظام.");
          return;
        }

        setLines((prev) => {
          const existing = prev.find((l) => l.product.id === found.id);
          if (existing) {
            return prev.map((l) => (l.product.id === found.id ? { ...l, qty: l.qty + 1 } : l));
          }
          return [...prev, { product: found, qty: 1 }];
        });
        setPage(Math.ceil((lines.length + 1) / PAGE_SIZE));
        return;
      }
      const char = getEnglishCharFromEvent(e);
      if (char) {
        burstRef.current.push(char);
        pendingRef.current = true;
        setLive(burstRef.current.join(""));
        if (pendingTimerRef.current !== null) window.clearTimeout(pendingTimerRef.current);
        pendingTimerRef.current = window.setTimeout(() => {
          clearPending();
          pendingTimerRef.current = null;
        }, 2000);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // The handler jumps to the page holding the line it just added, and it
    // reads the current length to do it. Without that in the closure every
    // scan after the first page would jump back to page one.
  }, [lines.length]);

  const unitPrice = (l: Line) => Number(l.product.price);
  const lineTotal = (l: Line) => unitPrice(l) * l.qty;
  const total = lines.reduce((sum, l) => sum + lineTotal(l), 0);
  const totalPages = Math.max(1, Math.ceil(lines.length / PAGE_SIZE));
  const pageLines = lines.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const openBulk = (type: "IN" | "OUT") => {
    if (lines.length === 0) {
      setMessage("لا توجد منتجات في القائمة.");
      return;
    }
    setBulkType(type);
    setBulkLocationId((prev) => prev || locations[0]?.id || "");
    setBulkError("");
    setShowBulkConfirm(true);
  };

  const submitBulk = async () => {
    if (!bulkLocationId) {
      setBulkError("يرجى اختيار موقع التخزين.");
      return;
    }
    setBulkSubmitting(true);
    setBulkError("");
    try {
      // No bulk endpoint exists; each line becomes one counted correction and
      // the current level is read first so the delta is exact.
      const levels = await inventoryApi.listStockLevels({
        storageLocationId: bulkLocationId,
        pageSize: 200,
      });
      let applied = 0;
      for (const line of lines) {
        const onHand = levels.items.find((row) => row.product.id === line.product.id)?.onHand ?? 0;
        const counted = bulkType === "IN" ? onHand + line.qty : onHand - line.qty;
        await inventoryApi.adjustStock({
          productId: line.product.id,
          storageLocationId: bulkLocationId,
          countedQuantity: counted,
          reason: bulkType === "IN" ? "إدخال دفعة من جهاز المسح" : "إخراج دفعة من جهاز المسح",
        });
        applied++;
      }
      setShowBulkConfirm(false);
      setBulkNotice(`تم تنفيذ العملية على ${applied} صنف بنجاح.`);
      setLines([]);
      setPage(1);
    } catch (error) {
      setBulkError(error instanceof Error ? error.message : "فشل تنفيذ العملية.");
    } finally {
      setBulkSubmitting(false);
    }
  };

  return (
    <div className="pos-layout">
      {/* POS Top Header */}
      <div className="pos-header">
        <div className="pos-title-container">
          <h1 className="pos-title">المسح الضوئي (POS)</h1>
        </div>
        <div className="pos-header-actions">
          <button
            onClick={(e) => {
              e.currentTarget.blur();
              setCustomSku("");
              setSystemSku("");
              setMappingMsg("");
              setPickerSearch("");
              setPickerPage(1);
              setShowSettings(true);
            }}
            className="pos-icon-btn"
            title="إعدادات ربط الأكواد"
          >
            <GearIcon />
          </button>
          <button
            onClick={(e) => {
              e.currentTarget.blur();
              navigate("/dashboard");
            }}
            className="pos-btn-back"
          >
            الرجوع للوحة التحكم
          </button>
        </div>
      </div>

      {/* Mobile Checker */}
      {!isDesktop && (
        <div
          style={{
            textAlign: "center",
            padding: "5rem 1rem",
            background: "var(--bg-primary)",
            borderRadius: "12px",
            border: "1px solid var(--border-color)",
            color: "var(--text-secondary)",
          }}
        >
          <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>🖥️</div>
          <h2 style={{ fontSize: "1.2rem", color: "var(--text-primary)" }}>
            شاشة المسح غير متوافقة
          </h2>
          <p style={{ fontSize: "0.85rem" }}>
            هذه الصفحة مخصصة للاستخدام على أجهزة الكمبيوتر المكتبية أو شاشات POS العريضة لتفعيل
            خاصية قارئ الباركود.
          </p>
        </div>
      )}

      {/* POS Terminal Desktop View */}
      {isDesktop && (
        <>
          {/* Laser Scanner Barcode Panel */}
          <div className="pos-scanner-container">
            <div className="pos-laser-line"></div>
            <input
              ref={scannerInputRef}
              type="text"
              className="pos-scanner-input"
              value={live}
              readOnly
              onFocus={() => setMessage("")}
              placeholder="بانتظار مسح الباركود..."
            />
          </div>

          {/* Alert notices */}
          {loading && (
            <div className="pos-alert-box pos-alert-notice" style={{ textAlign: "center" }}>
              جاري تحميل البيانات...
            </div>
          )}
          {error && (
            <div className="pos-alert-box pos-alert-error" style={{ textAlign: "center" }}>
              {error}
            </div>
          )}
          {message && (
            <div className="pos-alert-box pos-alert-error" style={{ textAlign: "center" }}>
              {message}
            </div>
          )}
          {bulkNotice && (
            <div className="pos-alert-box pos-alert-notice" style={{ textAlign: "center" }}>
              {bulkNotice}
            </div>
          )}

          {/* Main workspace */}
          {!loading && !error && (
            <div className="pos-workspace">
              {/* Right column: Scanned lines */}
              <div className="pos-items-panel">
                <h3 className="pos-panel-title">الأصناف الممسوحة</h3>

                {lines.length === 0 ? (
                  <div className="pos-empty-state">
                    <svg
                      width="48"
                      height="48"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      style={{ opacity: 0.3, marginBottom: "0.5rem" }}
                    >
                      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                      <line x1="12" y1="22.08" x2="12" y2="12" />
                    </svg>
                    <span>امسح باركود منتج للبدء.</span>
                  </div>
                ) : (
                  <>
                    <div className="pos-table-scroll">
                      <table className="pos-table">
                        <thead>
                          <tr>
                            <th style={{ width: "40px" }}>#</th>
                            <th>المنتج</th>
                            <th>الباركود / SKU</th>
                            <th style={{ width: "80px" }}>الكمية</th>
                            <th>سعر الوحدة</th>
                            <th>الإجمالي</th>
                            <th style={{ width: "120px" }}></th>
                          </tr>
                        </thead>
                        <tbody>
                          {pageLines.map((l, index) => (
                            <tr key={l.product.id}>
                              <td>{(page - 1) * PAGE_SIZE + index + 1}</td>
                              <td style={{ fontWeight: 600 }}>{l.product.name}</td>
                              <td>
                                <span className="pos-barcode-tag">
                                  {l.product.barcode || l.product.skuCode}
                                </span>
                              </td>
                              <td>
                                <strong style={{ fontSize: "0.9rem" }}>
                                  x {toArabicNumerals(l.qty)}
                                </strong>
                              </td>
                              <td>{toArabicNumerals(unitPrice(l).toFixed(2))} ج.م</td>
                              <td style={{ fontWeight: 700 }}>
                                {toArabicNumerals(lineTotal(l).toFixed(2))} ج.م
                              </td>
                              <td>
                                <div className="pos-qty-actions">
                                  <button
                                    onClick={(e) => {
                                      e.currentTarget.blur();
                                      setLines((prev) =>
                                        prev.map((x) =>
                                          x.product.id === l.product.id
                                            ? { ...x, qty: x.qty + 1 }
                                            : x,
                                        ),
                                      );
                                      focusScanner();
                                    }}
                                    className="pos-qty-btn"
                                    title="إضافة"
                                  >
                                    +
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.currentTarget.blur();
                                      setLines((prev) =>
                                        prev.flatMap((x) =>
                                          x.product.id === l.product.id && x.qty > 1
                                            ? [{ ...x, qty: x.qty - 1 }]
                                            : [x],
                                        ),
                                      );
                                      focusScanner();
                                    }}
                                    className="pos-qty-btn"
                                    title="إزالة 1"
                                  >
                                    -
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.currentTarget.blur();
                                      setLines((prev) =>
                                        prev.filter((x) => x.product.id !== l.product.id),
                                      );
                                      focusScanner();
                                    }}
                                    className="pos-qty-btn pos-qty-btn-delete"
                                    title="حذف المنتج"
                                  >
                                    ✕
                                  </button>
                                </div>
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
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginTop: "1rem",
                          paddingTop: "0.75rem",
                          borderTop: "1px solid var(--border-color)",
                        }}
                      >
                        <div style={{ display: "flex", gap: "0.4rem" }}>
                          <button
                            onClick={(e) => {
                              e.currentTarget.blur();
                              setPage((p) => Math.max(1, p - 1));
                              focusScanner();
                            }}
                            disabled={page <= 1}
                            className="pos-qty-btn"
                            style={{ width: "auto", padding: "0.2rem 0.8rem", height: "30px" }}
                          >
                            السابق
                          </button>
                          <button
                            onClick={(e) => {
                              e.currentTarget.blur();
                              setPage((p) => Math.min(totalPages, p + 1));
                              focusScanner();
                            }}
                            disabled={page >= totalPages}
                            className="pos-qty-btn"
                            style={{ width: "auto", padding: "0.2rem 0.8rem", height: "30px" }}
                          >
                            التالي
                          </button>
                        </div>
                        <span
                          style={{
                            fontSize: "0.8rem",
                            color: "var(--text-secondary)",
                            fontWeight: 600,
                          }}
                        >
                          {toArabicNumerals(page)} / {toArabicNumerals(totalPages)}
                        </span>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Left column: Receipt details and CTAs */}
              <div className="pos-receipt-card">
                <h3 className="pos-receipt-title">ملخص المسح</h3>

                <div className="pos-receipt-row">
                  <span>إجمالي الأصناف الممسوحة:</span>
                  <strong>{toArabicNumerals(lines.length)} صنف</strong>
                </div>

                <div className="pos-receipt-row">
                  <span>إجمالي القطع:</span>
                  <strong>{toArabicNumerals(lines.reduce((s, l) => s + l.qty, 0))} قطعة</strong>
                </div>

                <div className="pos-receipt-row total">
                  <span>المجموع الإجمالي</span>
                  <div className="pos-total-val">
                    {toArabicNumerals(total.toFixed(2))}{" "}
                    <span style={{ fontSize: "0.9rem", fontWeight: "normal" }}>ج.م</span>
                  </div>
                </div>

                {lines.length > 0 && (
                  <>
                    <div style={{ marginTop: "0.5rem" }}>
                      <label className="pos-receipt-select-label">موقع التخزين المستهدف</label>
                      <Select
                        value={bulkLocationId}
                        onChange={(val) => setBulkLocationId(String(val))}
                        options={locations.map((l) => ({ value: l.id, label: l.name }))}
                      />
                    </div>

                    <div className="pos-cta-grid" style={{ marginTop: "0.5rem" }}>
                      <button
                        onClick={(e) => {
                          e.currentTarget.blur();
                          openBulk("IN");
                        }}
                        className="pos-btn-cta pos-btn-incoming"
                      >
                        إدخال الكل (وارد)
                      </button>
                      <button
                        onClick={(e) => {
                          e.currentTarget.blur();
                          openBulk("OUT");
                        }}
                        className="pos-btn-cta pos-btn-outgoing"
                      >
                        إخراج الكل (صادر)
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* Settings Modal (Outer classes match ScannerTransactions for visual consistency) */}
      {showSettings && (
        <div
          className="pos-modal-overlay"
          onClick={() => {
            setShowSettings(false);
            focusScanner();
          }}
        >
          <div
            className="pos-modal-card"
            style={{ maxWidth: "680px" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="pos-modal-header">
              <h3 className="pos-modal-title">إعدادات ربط الأكواد الخارجية</h3>
              <button
                className="io-button io-button-secondary"
                style={{ fontSize: "0.8rem", padding: "0.35rem 0.75rem", minHeight: "auto" }}
                onClick={() => {
                  setShowSettings(false);
                  focusScanner();
                }}
              >
                إغلاق
              </button>
            </div>

            <div className="pos-settings-container">
              {/* Mapping Editor Form */}
              <div className="pos-settings-section">
                <h4
                  className="pos-settings-title"
                  style={{
                    fontSize: "0.8rem",
                    color: "var(--text-secondary)",
                    paddingBottom: "0.5rem",
                    marginBottom: "0.5rem",
                    borderBottom: "1px solid var(--border-color)",
                  }}
                >
                  ربط باركود خارجي جديد
                </h4>

                <input
                  type="text"
                  value={customSku}
                  onChange={(e) => setCustomSku(e.target.value)}
                  placeholder="الكود الخارجي (الباركود الممسوح)"
                  className="pos-settings-input"
                />

                <input
                  type="text"
                  value={pickerSearch}
                  onChange={(e) => {
                    setPickerSearch(e.target.value);
                    setPickerPage(1);
                  }}
                  placeholder="ابحث عن المنتج بنظام التشغيل..."
                  className="pos-settings-input"
                />

                <div className="pos-product-picker-table">
                  <table
                    style={{
                      width: "100%",
                      borderCollapse: "collapse",
                      fontSize: "0.75rem",
                      textAlign: "right",
                    }}
                  >
                    <thead>
                      <tr
                        style={{
                          background: "var(--bg-secondary)",
                          borderBottom: "1px solid var(--border-color)",
                        }}
                      >
                        <th style={{ padding: "0.4rem" }}>SKU</th>
                        <th style={{ padding: "0.4rem" }}>الاسم</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        const q = pickerSearch.trim().toLowerCase();
                        const filtered = q
                          ? productsRef.current.filter(
                              (p) =>
                                (p.skuCode || "").toLowerCase().includes(q) ||
                                (p.name || "").toLowerCase().includes(q) ||
                                (p.barcode || "").toLowerCase().includes(q),
                            )
                          : productsRef.current;
                        const total = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
                        const rows = filtered.slice(
                          (pickerPage - 1) * PAGE_SIZE,
                          pickerPage * PAGE_SIZE,
                        );
                        return (
                          <>
                            {rows.length === 0 && (
                              <tr>
                                <td
                                  colSpan={2}
                                  style={{
                                    padding: "0.5rem",
                                    textAlign: "center",
                                    color: "var(--text-muted)",
                                  }}
                                >
                                  لا نتائج.
                                </td>
                              </tr>
                            )}
                            {rows.map((p) => {
                              const isSelected = systemSku === p.skuCode;
                              return (
                                <tr
                                  key={p.id}
                                  onClick={() => {
                                    setSystemSku(p.skuCode ?? "");
                                    setMappingMsg("");
                                  }}
                                  style={{
                                    borderBottom: "1px solid #eee",
                                    cursor: "pointer",
                                    background: isSelected ? "rgba(0, 0, 0, 0.04)" : "transparent",
                                  }}
                                >
                                  <td style={{ padding: "0.4rem", fontFamily: "monospace" }}>
                                    {p.skuCode}
                                  </td>
                                  <td
                                    style={{
                                      padding: "0.4rem",
                                      fontWeight: isSelected ? 600 : 400,
                                    }}
                                  >
                                    {p.name}
                                  </td>
                                </tr>
                              );
                            })}
                            {rows.length > 0 && (
                              <tr>
                                <td
                                  colSpan={2}
                                  style={{
                                    padding: "0.4rem",
                                    background: "var(--bg-secondary)",
                                    borderTop: "1px solid var(--border-color)",
                                  }}
                                >
                                  <div
                                    style={{
                                      display: "flex",
                                      justifyContent: "space-between",
                                      alignItems: "center",
                                    }}
                                  >
                                    <div style={{ display: "flex", gap: "0.4rem" }}>
                                      <button
                                        onClick={(e) => {
                                          e.currentTarget.blur();
                                          setPickerPage((p) => Math.max(1, p - 1));
                                        }}
                                        disabled={pickerPage <= 1}
                                        className="io-button io-button-secondary"
                                        style={{
                                          fontSize: "0.7rem",
                                          padding: "0.15rem 0.6rem",
                                          height: "22px",
                                          minHeight: "auto",
                                          width: "auto",
                                        }}
                                      >
                                        السابق
                                      </button>
                                      <button
                                        onClick={(e) => {
                                          e.currentTarget.blur();
                                          setPickerPage((p) => Math.min(total, p + 1));
                                        }}
                                        disabled={pickerPage >= total}
                                        className="io-button io-button-secondary"
                                        style={{
                                          fontSize: "0.7rem",
                                          padding: "0.15rem 0.6rem",
                                          height: "22px",
                                          minHeight: "auto",
                                          width: "auto",
                                        }}
                                      >
                                        التالي
                                      </button>
                                    </div>
                                    <span
                                      style={{ fontSize: "0.7rem", color: "var(--text-secondary)" }}
                                    >
                                      {toArabicNumerals(pickerPage)} / {toArabicNumerals(total)}
                                    </span>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </>
                        );
                      })()}
                    </tbody>
                  </table>
                </div>

                <button
                  onClick={(e) => {
                    e.currentTarget.blur();
                    const custom = customSku.trim();
                    const system = systemSku.trim();
                    if (!custom || !system) {
                      setMappingMsg("يرجى إدخال الكود واختيار منتج.");
                      return;
                    }
                    if (mappings.some((m) => m.custom.toLowerCase() === custom.toLowerCase())) {
                      setMappingMsg("هذا الكود الخارجي مرتبط بالفعل.");
                      return;
                    }
                    setMappings((prev) => [...prev, { custom, system }]);
                    setCustomSku("");
                    setSystemSku("");
                    setMappingMsg("تم الربط بنجاح.");
                  }}
                  className="io-button io-button-primary"
                  style={{ minHeight: "auto", padding: "0.5rem", width: "100%" }}
                >
                  حفظ الربط
                </button>
                {mappingMsg && (
                  <div
                    style={{
                      fontSize: "0.78rem",
                      color: "var(--text-secondary)",
                      textAlign: "center",
                    }}
                  >
                    {mappingMsg}
                  </div>
                )}
              </div>

              {/* Mappings List Panel */}
              <div
                className="pos-settings-section"
                style={{ borderRight: "1px solid var(--border-color)", paddingRight: "1rem" }}
              >
                <h4
                  className="pos-settings-title"
                  style={{
                    fontSize: "0.8rem",
                    color: "var(--text-secondary)",
                    paddingBottom: "0.5rem",
                    marginBottom: "0.5rem",
                    borderBottom: "1px solid var(--border-color)",
                  }}
                >
                  الأكواد المرتبطة حالياً
                </h4>
                {mappings.length === 0 ? (
                  <div
                    style={{
                      fontSize: "0.8rem",
                      color: "var(--text-muted)",
                      textAlign: "center",
                      padding: "2rem 0",
                    }}
                  >
                    لا توجد روابط أكواد مخصصة.
                  </div>
                ) : (
                  <div
                    style={{
                      maxHeight: "280px",
                      overflowY: "auto",
                      display: "flex",
                      flexDirection: "column",
                      gap: "0.4rem",
                    }}
                  >
                    {mappings.map((m, i) => {
                      const product = productsRef.current.find(
                        (p) => (p.skuCode || "").toLowerCase() === m.system.toLowerCase(),
                      );
                      return (
                        <div
                          key={i}
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            border: "1px solid var(--border-color)",
                            borderRadius: "var(--radius-md)",
                            padding: "0.4rem 0.6rem",
                            background: "var(--bg-secondary)",
                            fontSize: "0.78rem",
                          }}
                        >
                          <div style={{ display: "flex", flexDirection: "column", gap: "0.15rem" }}>
                            <span style={{ fontFamily: "monospace", fontWeight: 600 }}>
                              {m.custom}
                            </span>
                            <span style={{ color: "var(--text-secondary)", fontSize: "0.72rem" }}>
                              ← {product ? `${m.system} - ${product.name}` : m.system}
                            </span>
                          </div>
                          <button
                            onClick={(e) => {
                              e.currentTarget.blur();
                              setMappings((prev) => prev.filter((_, idx) => idx !== i));
                            }}
                            className="pos-qty-btn pos-qty-btn-delete"
                            style={{ width: "22px", height: "22px" }}
                            title="حذف الربط"
                          >
                            ✕
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Confirmation Modal */}
      {showBulkConfirm && (
        <div
          className="pos-modal-overlay"
          onClick={() => {
            setShowBulkConfirm(false);
            focusScanner();
          }}
        >
          <div
            className="pos-modal-card"
            style={{ maxWidth: "420px" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="pos-modal-header" style={{ marginBottom: "1rem" }}>
              <h3 className="pos-modal-title">تأكيد عملية الدفعة</h3>
              <button
                className="io-button io-button-secondary"
                style={{ fontSize: "0.8rem", padding: "0.35rem 0.75rem", minHeight: "auto" }}
                onClick={() => {
                  setShowBulkConfirm(false);
                  focusScanner();
                }}
              >
                إغلاق
              </button>
            </div>

            <div
              style={{
                fontSize: "0.85rem",
                color: "var(--text-secondary)",
                marginBottom: "1.25rem",
                lineHeight: 1.6,
              }}
            >
              سيتم تنفيذ عملية{" "}
              <strong>{bulkType === "IN" ? "إدخال (وارد)" : "إخراج (صادر)"}</strong> لعدد{" "}
              <strong>{toArabicNumerals(lines.length)}</strong> صنف بإجمالي{" "}
              <strong>{toArabicNumerals(lines.reduce((s, l) => s + l.qty, 0))}</strong> قطعة في موقع
              التخزين{" "}
              <strong>{locations.find((l) => l.id === bulkLocationId)?.name || "غير معروف"}</strong>
              .
            </div>

            {bulkError && (
              <div className="pos-alert-box pos-alert-error" style={{ marginBottom: "1rem" }}>
                {bulkError}
              </div>
            )}

            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
              <button
                onClick={() => {
                  setShowBulkConfirm(false);
                  focusScanner();
                }}
                disabled={bulkSubmitting}
                className="io-button io-button-secondary"
                style={{ minHeight: "auto", padding: "0.5rem 1rem" }}
              >
                إلغاء
              </button>
              <button
                onClick={() => void submitBulk()}
                disabled={bulkSubmitting}
                className="io-button io-button-primary"
                style={{
                  minHeight: "auto",
                  padding: "0.5rem 1.25rem",
                  background: bulkType === "IN" ? "var(--color-success)" : "var(--color-danger)",
                  color: "var(--color-accent-contrast)",
                }}
              >
                {bulkSubmitting ? "جاري التنفيذ..." : "تأكيد التنفيذ"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
