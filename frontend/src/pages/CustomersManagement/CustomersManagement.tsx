import { Fragment, useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import DashboardLayout from "../../components/DashboardLayout/DashboardLayout";
import { toArabicNumerals } from "../../utils/arabicNumerals";
import { salesApi, type Customer, type CustomerOrder } from "../../lib/api";
import {
  ModuleHeading,
  ModuleActions,
  StatusBanner,
  ListToolbar,
  LoadingState,
  EmptyState,
  EditorHeader,
  EditorActions,
  RowActions,
  ActiveBadge,
  UsersIcon,
  type Notice,
} from "../shared/ManagementUi";
import "../SystemSettings/SystemSettings.css";

interface CustomersManagementProps {
  navigate: (path: string) => void;
}

const PAGE_SIZE = 10;

function CustomersTab() {
  const [items, setItems] = useState<Customer[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [name, setName] = useState("");
  const [phone1, setPhone1] = useState("");
  const [phone2, setPhone2] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [lastLoaded, setLastLoaded] = useState<Date | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [ordersCache, setOrdersCache] = useState<Record<string, CustomerOrder[]>>({});
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [totalEntries, setTotalEntries] = useState(0);

  const load = useCallback(async (showLoader = true, currentPage = page) => {
    if (showLoader) setLoading(true);
    try {
      // Paged rather than pulled in one go: this list grows with the customer
      // base, and a bounded fetch silently dropped everyone past the ceiling.
      const result = await salesApi.listCustomers({ page: currentPage, pageSize: PAGE_SIZE });
      setItems(result.items);
      setTotalPages(result.totalPages);
      setTotalEntries(result.total);
      setLastLoaded(new Date());
    } catch (error) {
      setNotice({
        type: "error",
        text: error instanceof Error ? error.message : "تعذر تحميل العملاء.",
      });
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    void load();
  }, [load]);

  const goToPage = (next: number) => {
    // Only state changes: `load` depends on `page`, so the effect refetches once.
    setPage(next);
  };

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        item.phoneNumber1.includes(q) ||
        (item.phoneNumber2 || "").includes(q),
    );
  }, [items, query]);

  const toggleOrders = async (item: Customer) => {
    if (expandedId === item.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(item.id);
    if (!ordersCache[item.id]) {
      setOrdersLoading(true);
      try {
        const orders = await salesApi.listCustomerOrders(item.id);
        setOrdersCache((c) => ({ ...c, [item.id]: orders }));
      } catch {
        /* row falls back to empty */
      } finally {
        setOrdersLoading(false);
      }
    }
  };

  const startAdd = () => {
    setEditing(null);
    setName("");
    setPhone1("");
    setPhone2("");
    setEmail("");
    setAddress("");
    setNotes("");
    setIsActive(true);
    setFormOpen(true);
    setNotice(null);
  };
  const startEdit = (item: Customer) => {
    setEditing(item);
    setName(item.name);
    setPhone1(item.phoneNumber1);
    setPhone2(item.phoneNumber2 || "");
    setEmail(item.email || "");
    setAddress(item.address || "");
    setNotes(item.notes || "");
    setIsActive(item.isActive);
    setFormOpen(true);
    setNotice(null);
  };
  const closeForm = () => {
    setFormOpen(false);
    setEditing(null);
    setName("");
    setPhone1("");
    setPhone2("");
    setEmail("");
    setAddress("");
    setNotes("");
    setIsActive(true);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      setNotice({ type: "error", text: "يرجى إدخال اسم العميل." });
      return;
    }
    if (!phone1.trim()) {
      setNotice({ type: "error", text: "يرجى إدخال رقم هاتف العميل." });
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      const payload = {
        name: name.trim(),
        phoneNumber1: phone1.trim(),
        phoneNumber2: phone2.trim() || null,
        email: email.trim() || null,
        address: address.trim() || null,
        notes: notes.trim() || null,
        isActive,
      };
      if (editing) {
        await salesApi.updateCustomer(editing.id, payload);
        setNotice({ type: "success", text: "تم تحديث بيانات العميل بنجاح." });
      } else {
        await salesApi.createCustomer(payload);
        setNotice({ type: "success", text: "تمت إضافة العميل بنجاح." });
      }
      closeForm();
      await load(false);
    } catch (error) {
      setNotice({
        type: "error",
        text: error instanceof Error ? error.message : "تعذر حفظ البيانات.",
      });
    } finally {
      setSaving(false);
    }
  };

  const remove = async (item: Customer) => {
    if (!window.confirm(`هل أنت متأكد من حذف العميل «${item.name}»؟`)) return;
    setSaving(true);
    setNotice(null);
    try {
      await salesApi.deleteCustomer(item.id);
      setNotice({ type: "success", text: "تم حذف العميل بنجاح." });
      if (editing?.id === item.id) closeForm();
      await load(false);
    } catch (error) {
      setNotice({
        type: "error",
        text: error instanceof Error ? error.message : "تعذر حذف العميل.",
      });
    } finally {
      setSaving(false);
    }
  };

  return {
    items,
    filteredItems,
    page,
    totalPages,
    totalEntries,
    goToPage,
    query,
    setQuery,
    loading,
    saving,
    formOpen,
    editing,
    name,
    setName,
    phone1,
    setPhone1,
    phone2,
    setPhone2,
    email,
    setEmail,
    address,
    setAddress,
    notes,
    setNotes,
    isActive,
    setIsActive,
    notice,
    lastLoaded,
    load,
    startAdd,
    startEdit,
    closeForm,
    submit,
    remove,
    expandedId,
    ordersCache,
    ordersLoading,
    toggleOrders,
  };
}

function CustomersView() {
  const t = CustomersTab();
  const ORDER_STATUS: Record<string, string> = {
    NEW: "جديد",
    CONFIRMED: "مؤكد",
    POSTPONED: "مؤجل",
    CANCELLED: "ملغي",
    NO_ANSWER: "لا يرد",
    DELIVERED: "تم التوصيل",
    RETURNED: "مرتجع",
    NOT_DELIVERED: "لم يُسلّم",
    ON_THE_WAY: "في الطريق",
    RETURNED_TO_WAREHOUSE: "أُعيد للمخزن",
  };
  return (
    <section className="ss-module animate-fade-in">
      <ModuleHeading
        icon={<UsersIcon />}
        eyebrow="إدارة العملاء"
        title="العملاء (Customers)"
        subtitle="قاعدة بيانات العملاء وأرقام هواتفهم المستخدمة في الطلبات اليدوية."
      />
      <ModuleActions
        count={t.totalEntries}
        countLabel="عميل"
        onRefresh={() => void t.load()}
        loading={t.loading}
        saving={t.saving}
        onAdd={t.startAdd}
        addLabel="إضافة عميل"
      />
      <StatusBanner notice={t.notice} />
      <ListToolbar
        query={t.query}
        setQuery={t.setQuery}
        placeholder="ابحث بالاسم أو رقم الهاتف..."
        lastLoaded={t.lastLoaded}
      />
      {t.formOpen && (
        <form className="ss-multi-editor" onSubmit={t.submit}>
          <EditorHeader editing={!!t.editing} singular="العميل" />
          <div className="ss-editor-field">
            <label htmlFor="customer-name">اسم العميل</label>
            <input
              id="customer-name"
              className="ss-input"
              value={t.name}
              onChange={(event) => t.setName(event.target.value)}
              placeholder="اسم العميل"
              autoFocus
              disabled={t.saving}
            />
          </div>
          <div className="ss-editor-field">
            <label htmlFor="customer-phone1">رقم الهاتف الأساسي</label>
            <input
              id="customer-phone1"
              className="ss-input"
              value={t.phone1}
              onChange={(event) => t.setPhone1(event.target.value)}
              placeholder="01xxxxxxxxx"
              disabled={t.saving}
            />
          </div>
          <div className="ss-editor-field">
            <label htmlFor="customer-phone2">رقم هاتف إضافي</label>
            <input
              id="customer-phone2"
              className="ss-input"
              value={t.phone2}
              onChange={(event) => t.setPhone2(event.target.value)}
              placeholder="اختياري"
              disabled={t.saving}
            />
          </div>
          <div className="ss-editor-field">
            <label htmlFor="customer-email">البريد الإلكتروني</label>
            <input
              id="customer-email"
              className="ss-input"
              type="email"
              dir="ltr"
              value={t.email}
              onChange={(event) => t.setEmail(event.target.value)}
              placeholder="اختياري"
              disabled={t.saving}
            />
          </div>
          <div className="ss-editor-field">
            <label htmlFor="customer-address">العنوان</label>
            <input
              id="customer-address"
              className="ss-input"
              value={t.address}
              onChange={(event) => t.setAddress(event.target.value)}
              placeholder="اختياري"
              disabled={t.saving}
            />
          </div>
          <div className="ss-editor-field ss-multi-editor-full">
            <label htmlFor="customer-notes">ملاحظات</label>
            <textarea
              id="customer-notes"
              className="ss-input"
              rows={2}
              value={t.notes}
              onChange={(event) => t.setNotes(event.target.value)}
              placeholder="اختياري"
              disabled={t.saving}
            />
          </div>
          <div className="ss-editor-field ss-multi-editor-full">
            <label className="ss-checkbox-label">
              <input
                type="checkbox"
                checked={t.isActive}
                onChange={(e) => t.setIsActive(e.target.checked)}
                disabled={t.saving}
              />
              <span>عميل نشط</span>
            </label>
          </div>
          <EditorActions closeForm={t.closeForm} saving={t.saving} editing={!!t.editing} />
        </form>
      )}
      <div className="ss-data-surface">
        {t.loading ? (
          <LoadingState />
        ) : t.filteredItems.length === 0 ? (
          <EmptyState hasSearch={Boolean(t.query.trim())} />
        ) : (
          <div className="ss-table-scroll">
            <table className="ss-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>الاسم</th>
                  <th>الهاتف الأساسي</th>
                  <th>هاتف إضافي</th>
                  <th>البريد</th>
                  <th>الطلبات</th>
                  <th>الحالة</th>
                  <th className="ss-actions-column">الإجراءات</th>
                </tr>
              </thead>
              <tbody>
                {t.filteredItems.map((item, index) => (
                  <Fragment key={item.id}>
                    <tr>
                      <td>
                        <span className="ss-row-number">{toArabicNumerals((t.page - 1) * PAGE_SIZE + index + 1)}</span>
                      </td>
                      <td>
                        <span className="ss-item-name">{item.name}</span>
                      </td>
                      <td>
                        <span dir="ltr">{item.phoneNumber1}</span>
                      </td>
                      <td>
                        <span dir="ltr">{item.phoneNumber2 || "—"}</span>
                      </td>
                      <td>
                        <span dir="ltr">{item.email || "—"}</span>
                      </td>
                      <td>
                        <button
                          className="io-icon-button"
                          style={{ color: "var(--color-accent)", fontWeight: 700, fontSize: "0.7rem" }}
                          onClick={() => void t.toggleOrders(item)}
                          title="عرض الطلبات"
                        >
                          {item._count.orders} طلب
                        </button>
                      </td>
                      <td>
                        <ActiveBadge isActive={item.isActive} />
                      </td>
                      <RowActions
                        onEdit={() => t.startEdit(item)}
                        onDelete={() => void t.remove(item)}
                        saving={t.saving}
                        name={item.name}
                      />
                    </tr>
                    {t.expandedId === item.id && (
                      <tr key={`${item.id}-orders`}>
                        <td colSpan={8}>
                          <div
                            style={{
                              background: "var(--bg-secondary)",
                              borderRadius: 10,
                              padding: "0.9rem",
                            }}
                          >
                            {t.ordersLoading && !t.ordersCache[item.id] && (
                              <div style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
                                جارٍ تحميل الطلبات...
                              </div>
                            )}
                            {t.ordersCache[item.id] && t.ordersCache[item.id].length === 0 && (
                              <div style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
                                لا توجد طلبات لهذا العميل.
                              </div>
                            )}
                            {t.ordersCache[item.id] && t.ordersCache[item.id].length > 0 && (
                              <table className="ss-table" style={{ fontSize: "0.8rem" }}>
                                <thead>
                                  <tr>
                                    <th>رقم الطلب</th>
                                    <th>الحالة</th>
                                    <th>التاريخ</th>
                                    <th>الإجمالي</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {t.ordersCache[item.id].map((o) => (
                                    <tr key={o.id}>
                                      <td dir="ltr" style={{ fontFamily: "monospace" }}>
                                        {o.orderNumber}
                                      </td>
                                      <td>{ORDER_STATUS[o.status] ?? o.status}</td>
                                      <td>{new Date(o.createdAt).toLocaleDateString("ar-EG")}</td>
                                      <td>{Number(o.orderActualPrice).toLocaleString("ar-EG")}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
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
      {!t.loading && t.totalPages > 1 && (
        <div className="ss-list-toolbar" style={{ justifyContent: "center" }}>
          <button
            type="button"
            className="ss-btn-save"
            onClick={() => t.goToPage(t.page - 1)}
            disabled={t.page <= 1 || t.loading}
          >
            السابق
          </button>
          <span className="ss-count-chip">
            صفحة {toArabicNumerals(t.page)} من {toArabicNumerals(t.totalPages)}
          </span>
          <button
            type="button"
            className="ss-btn-save"
            onClick={() => t.goToPage(t.page + 1)}
            disabled={t.page >= t.totalPages || t.loading}
          >
            التالي
          </button>
        </div>
      )}
    </section>
  );
}

export default function CustomersManagement({ navigate }: CustomersManagementProps) {
  return (
    <DashboardLayout navigate={navigate}>
      <div className="view-container">
        <CustomersView />
      </div>
    </DashboardLayout>
  );
}
