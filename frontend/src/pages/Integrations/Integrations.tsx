import { useCallback, useEffect, useState, type FormEvent } from "react";
import DashboardLayout from "../../components/DashboardLayout/DashboardLayout";
import RemoteImage from "../../components/RemoteImage/RemoteImage";
import { shippingApi, type Carrier } from "../../lib/api";
import { useCurrentUser } from "../../hooks/useCurrentUser";
import { useFilePicker } from "../../lib/useImageUpload";
import {
  ActiveBadge,
  Button,
  EditorActions,
  EditorHeader,
  EmptyState,
  LoadingState,
  ModuleHeading,
  StatusBanner,
  TruckIcon,
  type Notice,
} from "../shared/ManagementUi";
import "../SystemSettings/SystemSettings.css";

interface IntegrationsProps {
  navigate: (path: string) => void;
}

type CarrierForm = {
  name: string;
  code: string;
  isActive: boolean;
  type: Carrier["type"];
  logoUrl: string;
  defaultShippingCost: number;
  defaultCustomerShippingCost: number;
  returnShippingCost: number;
  autoSendOrderEnabled: boolean;
};

function emptyCarrier(): CarrierForm {
  return {
    name: "",
    code: "",
    isActive: true,
    type: "INTEGRATED",
    logoUrl: "",
    defaultShippingCost: 0,
    defaultCustomerShippingCost: 0,
    returnShippingCost: 0,
    autoSendOrderEnabled: false,
  };
}

export default function Integrations({ navigate }: IntegrationsProps) {
  const [carriers, setCarriers] = useState<Carrier[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Carrier | null>(null);
  const [form, setForm] = useState(emptyCarrier());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const { hasPermission, isCompanyOwner, isReady } = useCurrentUser();
  const canManage = isReady && (isCompanyOwner || hasPermission("Permissions.ManageCarriers"));
  const logoPicker = useFilePicker((url) => {
    if (url) setForm((current) => ({ ...current, logoUrl: url }));
  });

  const load = useCallback(async (showLoader = true) => {
    if (showLoader) setLoading(true);
    try {
      // The carriers directory is what this page manages.
      const carrierPage = await shippingApi.listCarriers({ pageSize: 100 });
      setCarriers(carrierPage.items);
    } catch (error) {
      setNotice({
        type: "error",
        text: error instanceof Error ? error.message : "تعذر تحميل التكاملات.",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      // The API takes numeric costs; the form already holds numbers.
      const payload = { ...form, logoUrl: form.logoUrl || undefined };
      if (editing) await shippingApi.updateCarrier(editing.id, payload);
      else
        await shippingApi.createCarrier({
          ...payload,
          code: form.code || "CAR-" + Date.now().toString(36).toUpperCase(),
        });
      setNotice({
        type: "success",
        text: editing ? "تم تحديث شركة الشحن." : "تم إضافة شركة الشحن.",
      });
      setFormOpen(false);
      setEditing(null);
      setForm(emptyCarrier());
      await load(false);
    } catch (error) {
      setNotice({
        type: "error",
        text: error instanceof Error ? error.message : "تعذر حفظ شركة الشحن.",
      });
    } finally {
      setSaving(false);
    }
  };

  const remove = async (item: Carrier) => {
    if (!window.confirm(`حذف ${item.name}؟`)) return;
    try {
      await shippingApi.deleteCarrier(item.id);
      await load(false);
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "تعذر الحذف." });
    }
  };

  return (
    <DashboardLayout navigate={navigate}>
      <div className="view-container">
        <section className="ss-module animate-fade-in">
          <ModuleHeading
            icon={<TruckIcon />}
            eyebrow="المنصة"
            title="شركات الشحن"
            subtitle="إدارة شركات التوصيل المتكاملة وأسعار الشحن الافتراضية لكل شركة."
          />
          <StatusBanner notice={notice} />
          <div className="ss-data-surface">
            {loading ? (
              <LoadingState />
            ) : (
              <>
                <div className="ss-module-actions">
                  <span className="ss-count-chip">
                    <strong>{carriers.length}</strong> شركة
                  </span>
                  {canManage && (
                    <Button
                      onClick={() => {
                        setEditing(null);
                        setForm(emptyCarrier());
                        setFormOpen((open) => !open);
                      }}
                      disabled={saving}
                    >
                      شركة جديدة
                    </Button>
                  )}
                </div>
                {formOpen && (
                  <form className="ss-editor-surface" onSubmit={submit}>
                    <EditorHeader editing={Boolean(editing)} singular="شركة شحن" />
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
                          value={form.code ?? ""}
                          onChange={(event) =>
                            setForm({ ...form, code: event.target.value.toUpperCase() })
                          }
                          required
                        />
                      </label>
                      <label>
                        شعار شركة الشحن
                        <span style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                          <input
                            ref={logoPicker.inputRef}
                            type="file"
                            accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
                            style={{ display: "none" }}
                            onChange={(event) => void logoPicker.onChange(event)}
                          />
                          <button
                            type="button"
                            className="io-button io-button-ghost"
                            onClick={logoPicker.openPicker}
                            disabled={logoPicker.uploading || saving}
                          >
                            {logoPicker.uploading ? "جاري الرفع..." : "اختيار صورة"}
                          </button>
                          {form.logoUrl && <RemoteImage path={form.logoUrl} alt="شعار شركة الشحن" className="ss-file-preview" />}
                          {form.logoUrl && (
                            <button
                              type="button"
                              className="io-button io-button-ghost"
                              onClick={() => setForm((current) => ({ ...current, logoUrl: "" }))}
                              disabled={saving}
                            >
                              إزالة الصورة
                            </button>
                          )}
                        </span>
                      </label>
                      <label>
                        سعر الشحن
                        <input
                          className="ss-input"
                          type="number"
                          min="0"
                          step="0.01"
                          value={form.defaultShippingCost}
                          onChange={(event) =>
                            setForm({ ...form, defaultShippingCost: Number(event.target.value) })
                          }
                        />
                      </label>
                      <label>
                        سعر العميل
                        <input
                          className="ss-input"
                          type="number"
                          min="0"
                          step="0.01"
                          value={form.defaultCustomerShippingCost}
                          onChange={(event) =>
                            setForm({
                              ...form,
                              defaultCustomerShippingCost: Number(event.target.value),
                            })
                          }
                        />
                      </label>
                      <label>
                        سعر المرتجع
                        <input
                          className="ss-input"
                          type="number"
                          min="0"
                          step="0.01"
                          value={form.returnShippingCost}
                          onChange={(event) =>
                            setForm({ ...form, returnShippingCost: Number(event.target.value) })
                          }
                        />
                      </label>
                      <label className="ss-checkbox">
                        <input
                          type="checkbox"
                          checked={form.isActive}
                          onChange={(event) => setForm({ ...form, isActive: event.target.checked })}
                        />{" "}
                        نشطة
                      </label>
                      <label className="ss-checkbox">
                        <input
                          type="checkbox"
                          checked={form.autoSendOrderEnabled}
                          onChange={(event) =>
                            setForm({ ...form, autoSendOrderEnabled: event.target.checked })
                          }
                        />{" "}
                        إرسال تلقائي
                      </label>
                    </div>
                    <EditorActions
                      closeForm={() => setFormOpen(false)}
                      saving={saving}
                      editing={Boolean(editing)}
                    />
                  </form>
                )}
                {carriers.length === 0 ? (
                  <EmptyState hasSearch={false} />
                ) : (
                  <div className="ss-table-scroll">
                    <table className="ss-table">
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>الشركة</th>
                          <th>المفتاح</th>
                          <th>سعر الشحن</th>
                          <th>سعر العميل</th>
                          <th>الإرسال التلقائي</th>
                          <th>الحالة</th>
                          <th>إجراءات</th>
                        </tr>
                      </thead>
                      <tbody>
                        {carriers.map((item, index) => (
                          <tr key={item.id}>
                            <td>{index + 1}</td>
                            <td>{item.name}</td>
                            <td>
                              <span dir="ltr">{item.code}</span>
                            </td>
                            <td>{item.defaultShippingCost}</td>
                            <td>{item.defaultCustomerShippingCost}</td>
                            <td>{item.autoSendOrderEnabled ? "نعم" : "لا"}</td>
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
                                        isActive: item.isActive,
                                        type: item.type,
                                        logoUrl: item.logoUrl || "",
                                        defaultShippingCost: Number(item.defaultShippingCost),
                                        defaultCustomerShippingCost: Number(
                                          item.defaultCustomerShippingCost,
                                        ),
                                        returnShippingCost: Number(item.returnShippingCost),
                                        autoSendOrderEnabled: item.autoSendOrderEnabled,
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
              </>
            )}
          </div>
        </section>
      </div>
    </DashboardLayout>
  );
}
