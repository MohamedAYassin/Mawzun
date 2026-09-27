import { useEffect, useState } from "react";
import {
  ApiError,
  settingsApi,
  type CompanySettings,
  type UpdateSettingsInput,
} from "../../lib/api";
import { type SettingsFieldType, type SettingsSectionDef } from "./settingsSections";

// Typed settings forms.
//
// These replace the old scope/key/value editor, which stored every value as
// text and described its own fields with a hand-maintained string-keyed schema.
// That shape forced a runtime string-to-type coercion on every read, could not
// be validated or defaulted by the database, and let a typo in a key silently
// write a setting nobody would ever read again.
//
// Fields are now bound to real keys of CompanySettings, so a renamed column is
// a compile error rather than a blank field.

/** Renders the current value of a typed field as a string for an input. */
function toInputValue(value: unknown, type: SettingsFieldType): string {
  if (value === null || value === undefined) return "";
  if (type === "bool") return value ? "true" : "false";
  return String(value);
}

/** Coerces an input value back into the type the backend expects. */
function fromInputValue(raw: string, type: SettingsFieldType): unknown {
  if (type === "bool") return raw === "true";
  if (type === "number") {
    if (raw.trim() === "") return undefined;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return raw;
}

export default function SettingsSection({ section }: { section: SettingsSectionDef }) {
  const [values, setValues] = useState<Partial<Record<keyof UpdateSettingsInput, unknown>>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setNotice(null);
    void settingsApi
      .get()
      .then((settings) => {
        if (!mounted) return;
        const picked: Partial<Record<keyof UpdateSettingsInput, unknown>> = {};
        for (const field of section.fields) {
          picked[field.key] = settings[field.key as keyof CompanySettings];
        }
        setValues(picked);
      })
      .catch((error: unknown) => {
        if (mounted) {
          setNotice({
            type: "error",
            text: error instanceof ApiError ? error.message : "تعذر تحميل الإعدادات.",
          });
        }
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [section]);

  const set = (key: keyof UpdateSettingsInput, value: unknown) =>
    setValues((prev) => ({ ...prev, [key]: value }));

  const save = async () => {
    setSaving(true);
    setNotice(null);
    try {
      // Only this section's keys are sent. The counters (invoiceNextNumber and
      // friends) are intentionally not editable, so a partial patch cannot
      // disturb them.
      const patch: UpdateSettingsInput = {};
      for (const field of section.fields) {
        const value = values[field.key];
        if (value === undefined) continue;
        Object.assign(patch, { [field.key]: value });
      }
      const saved = await settingsApi.update(patch);

      const refreshed: Partial<Record<keyof UpdateSettingsInput, unknown>> = {};
      for (const field of section.fields) {
        refreshed[field.key] = saved[field.key as keyof CompanySettings];
      }
      setValues(refreshed);
      setNotice({ type: "success", text: "تم حفظ الإعدادات بنجاح." });
    } catch (error) {
      setNotice({
        type: "error",
        text: error instanceof ApiError ? error.message : "تعذر حفظ الإعدادات.",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="ss-module animate-fade-in">
      <div className="ss-module-heading">
        <div className="ss-module-icon">⚙</div>
        <div>
          <p className="ss-eyebrow">إعدادات الشركة</p>
          <h2>{section.title}</h2>
          <p>{section.description}</p>
        </div>
      </div>

      {notice && (
        <div
          className={`ss-status ss-status-${notice.type}`}
          role={notice.type === "error" ? "alert" : "status"}
        >
          <span>{notice.text}</span>
        </div>
      )}

      {loading ? (
        <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem" }}>جاري التحميل...</p>
      ) : (
        <>
          <div className="ss-multi-editor">
            {section.fields.map((field) => (
              <div
                key={field.key}
                className={`ss-editor-field ${field.type === "bool" ? "ss-multi-editor-full" : ""}`}
              >
                {field.type === "bool" ? (
                  <label className="ss-checkbox-label">
                    <input
                      type="checkbox"
                      checked={toInputValue(values[field.key], "bool") === "true"}
                      onChange={(e) => set(field.key, e.target.checked)}
                      disabled={saving}
                    />
                    <span>{field.label}</span>
                  </label>
                ) : (
                  <>
                    <label htmlFor={`set-${field.key}`}>{field.label}</label>
                    {field.type === "select" ? (
                      <select
                        id={`set-${field.key}`}
                        className="ss-input"
                        value={toInputValue(values[field.key], field.type)}
                        onChange={(e) => set(field.key, fromInputValue(e.target.value, field.type))}
                        disabled={saving}
                      >
                        <option value="">—</option>
                        {(field.options ?? []).map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        id={`set-${field.key}`}
                        className="ss-input"
                        type={field.type === "number" ? "number" : "text"}
                        value={toInputValue(values[field.key], field.type)}
                        onChange={(e) => set(field.key, fromInputValue(e.target.value, field.type))}
                        placeholder={field.placeholder}
                        disabled={saving}
                      />
                    )}
                    {field.hint && <small>{field.hint}</small>}
                  </>
                )}
              </div>
            ))}
          </div>
          <div className="ss-form-actions" style={{ marginTop: "0.9rem" }}>
            <button
              type="button"
              className="ss-button ss-button-primary"
              onClick={() => void save()}
              disabled={saving}
            >
              {saving ? "جاري الحفظ..." : "حفظ الإعدادات"}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
