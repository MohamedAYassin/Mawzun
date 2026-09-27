import { useEffect, useState, type FormEvent } from "react";
import DashboardLayout from "../../components/DashboardLayout/DashboardLayout";
import {
  ApiError,
  companyApi,
  type CompanyIdentity,
  type CompanyProfile as CompanyProfileDto,
} from "../../lib/api";
import { useCurrentUser } from "../../hooks/useCurrentUser";
import "./CompanyProfile.css";

// The company's identity.
//
// This is the surface that replaced the "company" settings scope. Those fields
// — legal name, tax number, address, phone — are columns on Company rather than
// rows in a settings table, because they describe who the company *is* and are
// needed on invoices and documents, not optional configuration.
//
// Operational options (invoice prefixes, stock rules, shipping costs) live on
// CompanySettings and are edited in the settings sections.

interface CompanyProfileProps {
  navigate: (path: string) => void;
}

const STATUS_LABEL: Record<CompanyProfileDto["status"], string> = {
  ACTIVE: "نشطة",
  SUSPENDED: "معلقة",
  CLOSED: "مغلقة",
};

const MONTHS = [
  "يناير",
  "فبراير",
  "مارس",
  "أبريل",
  "مايو",
  "يونيو",
  "يوليو",
  "أغسطس",
  "سبتمبر",
  "أكتوبر",
  "نوفمبر",
  "ديسمبر",
];

type EditableFields = {
  name: string;
  legalName: string;
  taxNumber: string;
  commercialNo: string;
  email: string;
  phoneNumber: string;
  website: string;
  addressLine: string;
  city: string;
  region: string;
  countryCode: string;
  postalCode: string;
  currencyCode: string;
  timeZone: string;
  locale: string;
  fiscalYearStartMonth: string;
};

const EMPTY: EditableFields = {
  name: "",
  legalName: "",
  taxNumber: "",
  commercialNo: "",
  email: "",
  phoneNumber: "",
  website: "",
  addressLine: "",
  city: "",
  region: "",
  countryCode: "",
  postalCode: "",
  currencyCode: "EGP",
  timeZone: "Africa/Cairo",
  locale: "ar",
  fiscalYearStartMonth: "1",
};

// Takes the identity rather than the whole profile: `PATCH /company` answers
// with the identity columns only, and the form edits nothing else, so this is
// the shape both the load and the save can feed it.
function toForm(identity: CompanyIdentity): EditableFields {
  return {
    name: identity.name ?? "",
    legalName: identity.legalName ?? "",
    taxNumber: identity.taxNumber ?? "",
    commercialNo: identity.commercialNo ?? "",
    email: identity.email ?? "",
    phoneNumber: identity.phoneNumber ?? "",
    website: identity.website ?? "",
    addressLine: identity.addressLine ?? "",
    city: identity.city ?? "",
    region: identity.region ?? "",
    countryCode: identity.countryCode ?? "",
    postalCode: identity.postalCode ?? "",
    currencyCode: identity.currencyCode ?? "EGP",
    timeZone: identity.timeZone ?? "Africa/Cairo",
    locale: identity.locale ?? "ar",
    fiscalYearStartMonth: String(identity.fiscalYearStartMonth ?? 1),
  };
}

export default function CompanyProfile({ navigate }: CompanyProfileProps) {
  const [profile, setProfile] = useState<CompanyProfileDto | null>(null);
  const [form, setForm] = useState<EditableFields>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const { isCompanyOwner, hasPermission, isReady } = useCurrentUser();
  // Editing the company is a configuration action, gated on the permission
  // rather than on ownership: an admin the owner trusts may be given it.
  const canEdit = isReady && (isCompanyOwner || hasPermission("Permissions.ManageSettings"));

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    void companyApi
      .profile()
      .then((data) => {
        if (!mounted) return;
        setProfile(data);
        setForm(toForm(data));
        setError(null);
      })
      .catch((e: unknown) => {
        if (mounted) setError(e instanceof ApiError ? e.message : "تعذر تحميل بيانات الشركة.");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const set = (key: keyof EditableFields, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setNotice(null);
    setError(null);
    try {
      const updated = await companyApi.update({
        name: form.name.trim() || undefined,
        legalName: form.legalName.trim() || null,
        taxNumber: form.taxNumber.trim() || null,
        commercialNo: form.commercialNo.trim() || null,
        email: form.email.trim() || null,
        phoneNumber: form.phoneNumber.trim() || null,
        website: form.website.trim() || null,
        addressLine: form.addressLine.trim() || null,
        city: form.city.trim() || null,
        region: form.region.trim() || null,
        countryCode: form.countryCode.trim() || null,
        postalCode: form.postalCode.trim() || null,
        currencyCode: form.currencyCode.trim(),
        timeZone: form.timeZone.trim(),
        locale: form.locale.trim(),
        fiscalYearStartMonth: Number(form.fiscalYearStartMonth),
      });
      // The save returns the identity columns and nothing else, so the profile
      // read at load keeps its owner, counters and settings rather than being
      // replaced by a response that simply does not carry them.
      setProfile((prev) => (prev ? { ...prev, ...updated } : prev));
      setForm(toForm(updated));
      setNotice("تم حفظ بيانات الشركة بنجاح.");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "تعذر حفظ بيانات الشركة.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <DashboardLayout navigate={navigate}>
        <div className="cp-container">
          <p className="cp-muted">جاري تحميل بيانات الشركة...</p>
        </div>
      </DashboardLayout>
    );
  }

  if (error && !profile) {
    return (
      <DashboardLayout navigate={navigate}>
        <div className="cp-container">
          <div className="cp-error" role="alert">
            <span>{error}</span>
            <button className="cp-retry" onClick={() => navigate("/system-settings")}>
              رجوع
            </button>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout navigate={navigate}>
      <div className="cp-container" dir="rtl">
        <header className="cp-header">
          <div>
            <h1 className="cp-title">ملف الشركة</h1>
            <p className="cp-subtitle">
              البيانات التعريفية والقانونية لنشاطك كما تظهر على الفواتير والمستندات.
            </p>
          </div>
          {profile && (
            <span className={`cp-status cp-status-${profile.status.toLowerCase()}`}>
              {STATUS_LABEL[profile.status]}
            </span>
          )}
        </header>

        {notice && (
          <div className="cp-notice" role="status">
            {notice}
          </div>
        )}
        {error && (
          <div className="cp-error" role="alert">
            <span>{error}</span>
          </div>
        )}

        {profile && (
          <>
            <section className="cp-identity">
              <div className="cp-identity-name">{profile.name}</div>
              <dl className="cp-facts">
                <div>
                  <dt>المالك</dt>
                  <dd>
                    {profile.owner.fullName} — {profile.owner.email}
                  </dd>
                </div>
                <div>
                  <dt>المعرّف (slug)</dt>
                  <dd dir="ltr">{profile.slug}</dd>
                </div>
                <div>
                  <dt>تاريخ الإنشاء</dt>
                  <dd>{new Date(profile.createdAt).toLocaleDateString("ar-EG")}</dd>
                </div>
                <div>
                  <dt>الأعضاء</dt>
                  <dd>{profile._count.users}</dd>
                </div>
                <div>
                  <dt>المنتجات</dt>
                  <dd>{profile._count.products}</dd>
                </div>
                <div>
                  <dt>الطلبات</dt>
                  <dd>{profile._count.orders}</dd>
                </div>
              </dl>
            </section>

            <form className="cp-form" onSubmit={(e) => void submit(e)}>
              <fieldset disabled={!canEdit || saving}>
                <legend>البيانات الأساسية</legend>
                <div className="cp-grid">
                  <label className="cp-field">
                    <span>اسم الشركة *</span>
                    <input
                      className="cp-input"
                      value={form.name}
                      onChange={(e) => set("name", e.target.value)}
                    />
                  </label>
                  <label className="cp-field">
                    <span>الاسم القانوني</span>
                    <input
                      className="cp-input"
                      value={form.legalName}
                      onChange={(e) => set("legalName", e.target.value)}
                      placeholder="الاسم المسجل رسمياً"
                    />
                  </label>
                  <label className="cp-field">
                    <span>الرقم الضريبي</span>
                    <input
                      className="cp-input"
                      value={form.taxNumber}
                      onChange={(e) => set("taxNumber", e.target.value)}
                    />
                  </label>
                  <label className="cp-field">
                    <span>السجل التجاري</span>
                    <input
                      className="cp-input"
                      value={form.commercialNo}
                      onChange={(e) => set("commercialNo", e.target.value)}
                    />
                  </label>
                </div>
              </fieldset>

              <fieldset disabled={!canEdit || saving}>
                <legend>بيانات التواصل</legend>
                <div className="cp-grid">
                  <label className="cp-field">
                    <span>البريد الإلكتروني</span>
                    <input
                      className="cp-input"
                      type="email"
                      dir="ltr"
                      value={form.email}
                      onChange={(e) => set("email", e.target.value)}
                    />
                  </label>
                  <label className="cp-field">
                    <span>الهاتف</span>
                    <input
                      className="cp-input"
                      dir="ltr"
                      value={form.phoneNumber}
                      onChange={(e) => set("phoneNumber", e.target.value)}
                    />
                  </label>
                  <label className="cp-field">
                    <span>الموقع الإلكتروني</span>
                    <input
                      className="cp-input"
                      dir="ltr"
                      value={form.website}
                      onChange={(e) => set("website", e.target.value)}
                      placeholder="https://"
                    />
                  </label>
                </div>
              </fieldset>

              <fieldset disabled={!canEdit || saving}>
                <legend>العنوان</legend>
                <div className="cp-grid">
                  <label className="cp-field cp-field-wide">
                    <span>الشارع / العنوان</span>
                    <input
                      className="cp-input"
                      value={form.addressLine}
                      onChange={(e) => set("addressLine", e.target.value)}
                    />
                  </label>
                  <label className="cp-field">
                    <span>المدينة</span>
                    <input
                      className="cp-input"
                      value={form.city}
                      onChange={(e) => set("city", e.target.value)}
                    />
                  </label>
                  <label className="cp-field">
                    <span>المحافظة / المنطقة</span>
                    <input
                      className="cp-input"
                      value={form.region}
                      onChange={(e) => set("region", e.target.value)}
                    />
                  </label>
                  <label className="cp-field">
                    <span>كود الدولة</span>
                    <input
                      className="cp-input"
                      dir="ltr"
                      maxLength={2}
                      value={form.countryCode}
                      onChange={(e) => set("countryCode", e.target.value.toUpperCase())}
                      placeholder="EG"
                    />
                  </label>
                  <label className="cp-field">
                    <span>الرمز البريدي</span>
                    <input
                      className="cp-input"
                      dir="ltr"
                      value={form.postalCode}
                      onChange={(e) => set("postalCode", e.target.value)}
                    />
                  </label>
                </div>
              </fieldset>

              <fieldset disabled={!canEdit || saving}>
                <legend>التوطين</legend>
                <div className="cp-grid">
                  <label className="cp-field">
                    <span>العملة</span>
                    <input
                      className="cp-input"
                      dir="ltr"
                      maxLength={3}
                      value={form.currencyCode}
                      onChange={(e) => set("currencyCode", e.target.value.toUpperCase())}
                    />
                  </label>
                  <label className="cp-field">
                    <span>المنطقة الزمنية</span>
                    <input
                      className="cp-input"
                      dir="ltr"
                      value={form.timeZone}
                      onChange={(e) => set("timeZone", e.target.value)}
                    />
                  </label>
                  <label className="cp-field">
                    <span>اللغة</span>
                    <input
                      className="cp-input"
                      dir="ltr"
                      value={form.locale}
                      onChange={(e) => set("locale", e.target.value)}
                    />
                  </label>
                  <label className="cp-field">
                    <span>بداية السنة المالية</span>
                    <select
                      className="cp-input"
                      value={form.fiscalYearStartMonth}
                      onChange={(e) => set("fiscalYearStartMonth", e.target.value)}
                    >
                      {MONTHS.map((month, index) => (
                        <option key={month} value={String(index + 1)}>
                          {month}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </fieldset>

              {canEdit && (
                <div className="cp-actions">
                  <button type="submit" className="cp-button cp-button-primary" disabled={saving}>
                    {saving ? "جاري الحفظ..." : "حفظ البيانات"}
                  </button>
                </div>
              )}
            </form>

            {!canEdit && (
              <p className="cp-muted">
                ليس لديك صلاحية تعديل بيانات الشركة. يمكن لمالك الشركة أو من يملك صلاحية إدارة
                الإعدادات تعديلها.
              </p>
            )}

            {profile.activatedAt && (
              <p className="cp-muted">
                تم تفعيل الحساب في{" "}
                {new Date(profile.activatedAt).toLocaleDateString("ar-EG")}.
              </p>
            )}
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
