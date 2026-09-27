import { useCallback, useMemo, useState } from 'react'
import { onboardingApi, type BusinessType, type CompleteOnboardingInput, type OnboardingStep } from '../../lib/api'
import './Onboarding.css'

// First-run setup wizard.
//
// WHY AN OVERLAY AND NOT A ROUTE
//
// A route can be navigated away from — the back button, a bookmark, a typed
// URL. Onboarding that can be escaped by accident is onboarding that gets
// half-done, leaving a company configured with a currency nobody chose. This
// renders over the dashboard shell instead, so the only way past it is to
// finish it or skip it deliberately.
//
// EVERY STEP IS SKIPPABLE, ON PURPOSE
//
// A user who wants to look around before committing should not be trapped. So
// each step has its own skip, the whole wizard has "skip everything", and the
// final call records which steps were passed over. The backend stores that
// list, so the app can prompt for the relevant thing later — in context, when
// the user actually needs it — instead of asking again blindly.
//
// Nothing here is decoration. Every question changes how the rest of the app
// behaves: the currency formats every price, the fiscal month decides the
// accounting year, the warehouse is what stock is counted against, the order
// prefix appears on every invoice.

interface OnboardingProps {
  /** Called after the wizard is finished or skipped. */
  onDone: () => void
}

const BUSINESS_TYPES: Array<{ value: BusinessType; label: string; hint: string }> = [
  { value: 'RETAIL', label: 'بيع مباشر', hint: 'متجر أو معرض يبيع للعملاء مباشرة' },
  { value: 'WHOLESALE', label: 'بيع بالجملة', hint: 'توريد للتجار بكميات كبيرة' },
  { value: 'MANUFACTURING', label: 'تصنيع', hint: 'تحويل مواد خام إلى منتجات' },
  { value: 'ECOMMERCE', label: 'تجارة إلكترونية', hint: 'بيع عبر الإنترنت أو متجر شوبيفاي' },
  { value: 'SERVICES', label: 'خدمات', hint: 'لا يوجد مخزون فعلي' },
  { value: 'OTHER', label: 'أخرى', hint: 'نشاط مختلف' },
]

const CURRENCIES = ['EGP', 'SAR', 'AED', 'USD', 'EUR', 'KWD', 'QAR'] as const
const TIME_ZONES = ['Africa/Cairo', 'Asia/Riyadh', 'Asia/Dubai', 'Asia/Kuwait', 'Asia/Qatar', 'UTC'] as const

const MONTHS = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
]

export default function Onboarding({ onDone }: OnboardingProps) {
  // Steps are shown in this order. `ONBOARDING_STEPS` on the backend is the
  // source of truth for the slugs (they are stored), and this array is keyed
  // by them — a slug added there without a title here renders nothing, which
  // is a visible failure rather than a silent one.
  const steps = useMemo<OnboardingStep[]>(
    () => ['business_type', 'locale_finance', 'first_location', 'order_defaults'],
    []
  )

  const [index, setIndex] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [skipped, setSkipped] = useState<OnboardingStep[]>([])

  // ---- answers ----
  const [businessType, setBusinessType] = useState<BusinessType | null>(null)
  const [currencyCode, setCurrencyCode] = useState('EGP')
  const [timeZone, setTimeZone] = useState('Africa/Cairo')
  const [fiscalYearStartMonth, setFiscalYearStartMonth] = useState(1)
  const [vatRate, setVatRate] = useState('14')
  const [warehouseName, setWarehouseName] = useState('المستودع الرئيسي')
  const [orderPrefix, setOrderPrefix] = useState('ORD')
  const [requireConfirmation, setRequireConfirmation] = useState(true)

  const current = steps[index]
  const isLast = index === steps.length - 1

  const skipStep = useCallback(
    (step: OnboardingStep) => {
      setSkipped((prev) => (prev.includes(step) ? prev : [...prev, step]))
      setIndex((i) => i + 1)
    },
    []
  )

  const finish = useCallback(
    async (skipAll: boolean) => {
      setSaving(true)
      setError(null)
      try {
        // Only send what the user actually answered. Sending defaults for a
        // skipped step would overwrite the provisioned value with a guess the
        // user never saw — the opposite of what skipping means.
        const payload: CompleteOnboardingInput = {
          skippedSteps: skipAll ? [...steps] : skipped,
        }
        if (!skipAll) {
          if (businessType) payload.businessType = businessType
          if (!skipped.includes('locale_finance')) {
            payload.currencyCode = currencyCode
            payload.timeZone = timeZone
            payload.fiscalYearStartMonth = fiscalYearStartMonth
            const parsed = Number(vatRate)
            if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 100) {
              payload.defaultSalesVatRate = parsed
            }
          }
          if (!skipped.includes('first_location') && warehouseName.trim()) {
            payload.warehouseName = warehouseName.trim()
          }
          if (!skipped.includes('order_defaults')) {
            if (orderPrefix.trim()) payload.orderPrefix = orderPrefix.trim()
            payload.requireOrderConfirmation = requireConfirmation
          }
        }
        await onboardingApi.complete(payload)
        onDone()
      } catch (e) {
        // Surfaced rather than swallowed: a failed save means the wizard will
        // show again next load, and the user should know that before they
        // spend time wondering whether it worked.
        setError(e instanceof Error ? e.message : 'تعذّر حفظ الإعدادات. حاول مرة أخرى.')
      } finally {
        setSaving(false)
      }
    },
    [
      skipped, steps, businessType, currencyCode, timeZone, fiscalYearStartMonth,
      vatRate, warehouseName, orderPrefix, requireConfirmation, onDone,
    ]
  )

  return (
    <div className="onb-overlay" role="dialog" aria-modal="true" aria-labelledby="onb-title">
      <div className="onb-card">
        <header className="onb-head">
          <div>
            <h1 id="onb-title" className="onb-title">تهيئة الشركة</h1>
            <p className="onb-sub">خطوات سريعة لضبط النظام على نشاطك — يمكنك تخطي أي خطوة.</p>
          </div>
          <button
            type="button"
            className="onb-skip-all"
            onClick={() => void finish(true)}
            disabled={saving}
          >
            تخطي الكل
          </button>
        </header>

        <ol className="onb-progress" aria-label="تقدم التهيئة">
          {steps.map((s, i) => (
            <li
              key={s}
              className={`onb-dot ${i === index ? 'is-current' : ''} ${i < index ? 'is-done' : ''} ${skipped.includes(s) ? 'is-skipped' : ''}`}
            >
              <span className="onb-dot-num">{i < index ? (skipped.includes(s) ? '–' : '✓') : i + 1}</span>
            </li>
          ))}
        </ol>

        <div className="onb-body">
          {current === 'business_type' && (
            <section>
              <h2 className="onb-step-title">ما نوع نشاطك؟</h2>
              <p className="onb-step-hint">يحدد هذا الوحدات التي تظهر لك أولاً.</p>
              <div className="onb-choices">
                {BUSINESS_TYPES.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    className={`onb-choice ${businessType === t.value ? 'is-selected' : ''}`}
                    onClick={() => setBusinessType(t.value)}
                  >
                    <span className="onb-choice-label">{t.label}</span>
                    <span className="onb-choice-hint">{t.hint}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {current === 'locale_finance' && (
            <section>
              <h2 className="onb-step-title">العملة والسنة المالية</h2>
              <p className="onb-step-hint">تُستخدم في كل الأسعار والفواتير والتقارير.</p>
              <div className="onb-grid">
                <label className="onb-field">
                  <span>العملة</span>
                  <select value={currencyCode} onChange={(e) => setCurrencyCode(e.target.value)}>
                    {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
                <label className="onb-field">
                  <span>المنطقة الزمنية</span>
                  <select value={timeZone} onChange={(e) => setTimeZone(e.target.value)}>
                    {TIME_ZONES.map((z) => <option key={z} value={z}>{z}</option>)}
                  </select>
                </label>
                <label className="onb-field">
                  <span>بداية السنة المالية</span>
                  <select value={fiscalYearStartMonth} onChange={(e) => setFiscalYearStartMonth(Number(e.target.value))}>
                    {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                  </select>
                </label>
                <label className="onb-field">
                  <span>ضريبة القيمة المضافة (%)</span>
                  <input
                    type="number" min={0} max={100} step="0.01"
                    value={vatRate} onChange={(e) => setVatRate(e.target.value)}
                  />
                </label>
              </div>
            </section>
          )}

          {current === 'first_location' && (
            <section>
              <h2 className="onb-step-title">أين تحتفظ بالمخزون؟</h2>
              <p className="onb-step-hint">
                أنشأنا لك مستودعاً بالفعل — سمّه بما تعرفه أنت. كل حركة مخزون تُسجّل مقابله.
              </p>
              <label className="onb-field">
                <span>اسم المستودع أو الموقع</span>
                <input
                  type="text" maxLength={200}
                  value={warehouseName} onChange={(e) => setWarehouseName(e.target.value)}
                  placeholder="مثال: المخزن الرئيسي - القاهرة"
                />
              </label>
            </section>
          )}

          {current === 'order_defaults' && (
            <section>
              <h2 className="onb-step-title">ترقيم الطلبات</h2>
              <p className="onb-step-hint">يظهر هذا البادئة على كل طلب وفاتورة.</p>
              <div className="onb-grid">
                <label className="onb-field">
                  <span>بادئة رقم الطلب</span>
                  <input
                    type="text" maxLength={20}
                    value={orderPrefix} onChange={(e) => setOrderPrefix(e.target.value)}
                    placeholder="ORD"
                  />
                </label>
              </div>
              <label className="onb-toggle">
                <input
                  type="checkbox"
                  checked={requireConfirmation}
                  onChange={(e) => setRequireConfirmation(e.target.checked)}
                />
                <span>
                  يتطلب تأكيد الطلب قبل خصم المخزون
                  <small>إذا ألغيت هذا، يُخصم المخزون بمجرد إنشاء الطلب.</small>
                </span>
              </label>
            </section>
          )}
        </div>

        {error && <p className="onb-error" role="alert">{error}</p>}

        <footer className="onb-foot">
          <button
            type="button"
            className="onb-btn-ghost"
            onClick={() => (index === 0 ? void finish(true) : setIndex((i) => i - 1))}
            disabled={saving}
          >
            {index === 0 ? 'لاحقاً' : 'السابق'}
          </button>

          <div className="onb-foot-right">
            <button
              type="button"
              className="onb-btn-ghost"
              onClick={() => skipStep(current)}
              disabled={saving}
            >
              تخطي هذه الخطوة
            </button>
            {isLast ? (
              <button type="button" className="onb-btn-primary" onClick={() => void finish(false)} disabled={saving}>
                {saving ? 'جاري الحفظ…' : 'إنهاء التهيئة'}
              </button>
            ) : (
              <button type="button" className="onb-btn-primary" onClick={() => setIndex((i) => i + 1)} disabled={saving}>
                التالي
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  )
}
