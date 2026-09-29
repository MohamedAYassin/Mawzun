import { useState } from 'react'
import type { JSX } from 'react'
import './Welcome.css'

interface WelcomeProps {
  navigate: (path: string) => void
}

// Arabic-only. The product UI is Arabic-first and the marketing site follows:
// one copy, RTL, no language toggle.
const t = {
  nav: { features: 'المزايا', modules: 'الوحدات', how: 'كيف يعمل', faq: 'الأسئلة', docs: 'API', status: 'Status' },
  login: 'تسجيل الدخول',
  start: 'ابدأ الآن',
  badge: 'نظام إدارة المبيعات والمخازن والعمليات',
  heroTitle: 'أدر مبيعاتك ومخازنك من مكان واحد',
  heroSub: (
    <>
      <img src="/mawzun_black.svg" width="270" height="107" alt="" aria-hidden="true" className="brand-inline" /> يجمع الطلبات، المخزون، المشتريات، الإنتاج، الشحن، والحسابات في لوحة واحدة واضحة — وفوقها قيادة مبيعات وقيادة مخزون تخبرك يومياً بما يحتاج إلى متابعة.
    </>
  ),
  heroNote: 'عربي أولاً · مزامنة Shopify تلقائية · مفاتيح API للوكلاء والمطورين',
  statsTitle: 'كل شيء تحت السيطرة',
  stats: [
    { value: '8', label: 'وحدات عمل مرتبة' },
    { value: '‎60+', label: 'شاشة تشغيلية' },
    { value: 'Ctrl K', label: 'بحث فوري عن أي شاشة' },
  ],
  featuresTitle: 'مصمم ليقلل الخطوات لا ليزيدها',
  features: [
    { t: 'قيادة المبيعات', d: 'الطلبات الجديدة، التي لا تستجيب، والمؤجلة، والعالقة في الشحن — كلها في قائمة انتباه واحدة بضغطة توصل للطلب.' },
    { t: 'قيادة المخزون', d: 'النوافذ والنواقص، الجرد المفتوح، والعمليات المعلقة، مع حركة داخل/خارج آخر ٣٠ يوم من الدفتر.' },
    { t: 'مزامنة Shopify تلقائية', d: 'اربط المتجر مرة واحدة: الطلبات والمنتجات والمرتجعات تُسجَّل تلقائياً، والمخزون يُرفع إلى المتجر كل ساعة.' },
    { t: 'وكلاء AI عبر API', d: 'مفاتيح API بمجال الشركة: قراءة وكتابة — الوكيل يستعلم، يبيع، يضبط المخزون، ويتابع الشحن.' },
    { t: 'دورة الطلب كاملة', d: 'من إضافة المبيعة والكوبونات إلى التأكيد والتجهيز والتغليف والشحن والمرتجعات والفواتير.' },
    { t: 'صلاحيات دقيقة', d: 'مستخدمون وأدوار وصلاحيات لكل فريق على حدة، وكل حركة مسجلة باسم صاحبها.' },
  ],
  modulesTitle: 'الوحدات الثماني',
  modules: [
    { t: 'الرئيسية', d: 'قيادة المبيعات وقيادة المخزون: ما يحتاج إلى متابعة أولاً، ثم الاتجاهات.' },
    { t: 'المبيعات', d: 'إضافة مبيعات، سجل الطلبات، التأكيد، العملاء والكوبونات والمصادر.' },
    { t: 'المخازن', d: 'المنتجات، المخزون، الحركات، الجرد، المواقع والتنبيهات.' },
    { t: 'المشتريات', d: 'أوامر الشراء، الموردون، الأمانات وعمليات المخزون.' },
    { t: 'التجهيز', d: 'السحب، التغليف، الباتشات، المسح، الشحن والمرتجعات.' },
    { t: 'الحسابات', d: 'دفتر اليومية، المعاملات، المحفظة وطرق الدفع.' },
    { t: 'البيانات', d: 'الماركات، الأقسام، الوحدات، الأسباب والمحافظات والمدن.' },
    { t: 'الإعدادات', d: 'المستخدمون، الأدوار، الصلاحيات، التكامل ومفاتيح API.' },
  ],
  howTitle: 'ثلاث خطوات للبدء',
  how: [
    { t: 'أنشئ حسابك', d: 'سجّل بيانات النشاط وابدأ من لوحة فارغة نظيفة.' },
    { t: 'أدخل بياناتك', d: 'المنتجات والمخازن والموردون وطرق الدفع في دقائق.' },
    { t: 'شغّل عملياتك', d: 'استقبل الطلبات، جهّزها، اشحنها وتابع حساباتك — أو اربط Shopify ودعه يعمل تلقائياً.' },
  ],
  faqTitle: 'أسئلة متكررة',
  faq: [
    { q: 'هل يدعم النظام العربية بالكامل؟', a: 'نعم، الواجهة عربية أولاً بالكامل مع دعم RTL — وهذا الموقع نفسه بالعربية فقط.' },
    { q: 'هل يتكامل مع Shopify؟', a: 'نعم. اربط المتجر من صفحة المتاجر وتُسجَّل الـ webhooks تلقائياً: الطلبات والمنتجات والمرتجعات تنعكس لحظياً، والمخزون المتاح يُرفع إلى متجرك كل ساعة.' },
    { q: 'هل يوجد API للوكلاء والمطورين؟', a: 'نعم. مفاتيح API بمجال الشركة تتيح قراءة وكتابة كاملة: منتجات، عملاء، كوبونات، طلبات، مخزون وتنبيهات — يعمل الوكيل كأنه موظف.' },
    { q: 'هل يمكن تحديد صلاحيات لكل مستخدم؟', a: 'نعم، عبر نظام الأدوار والصلاحيات يمكنك تحديد ما يراه كل فريق بدقة.' },
    { q: 'هل بياناتي محفوظة وقابلة للمراجعة؟', a: 'كل حركة مخزون تُسجَّل في دفتر غير قابل للتعديل، وكل عملية مالية في معاملات، وكل تغيير مهم في سجل تدقيق.' },
  ],
  ctaTitle: 'جاهز لتبسيط عملياتك؟',
  ctaSub: 'ابدأ بحساب جديد أو ادخل بحسابك الحالي.',
  footer: 'نظام إدارة المبيعات والمخازن والعمليات',
}

interface FloatChip {
  id: string
  className: string
  label: string
  sublabel?: string
  href: string
  icon: () => JSX.Element
}

const floatChips: FloatChip[] = [
  { id: 'shopify', className: 'float-shopify', label: 'Shopify', sublabel: 'طلب جديد · مزامنة تلقائية', href: 'https://www.shopify.com', icon: () => <img src="/integrations/shopify.svg" alt="" width={64} height={64} /> },
  { id: 'codex', className: 'float-codex', label: 'Codex', sublabel: 'وكيل البرمجة', href: 'https://chatgpt.com/codex', icon: () => <img src="/integrations/openai.svg" alt="" width={64} height={64} /> },
  { id: 'claude', className: 'float-claude', label: 'Claude', href: 'https://claude.ai', icon: () => <img src="/integrations/claude.webp" alt="" width={64} height={64} /> },
  { id: 'hermes', className: 'float-hermes', label: 'Hermes Agent', href: 'https://nousresearch.com', icon: () => <img src="/integrations/hermes.webp" alt="" width={64} height={64} /> },
  { id: 'clawdbot', className: 'float-clawdbot', label: 'Clawdbot', href: 'https://openclaw.ai', icon: () => <img src="/integrations/clawdbot.svg" alt="" width={64} height={64} /> },
]

function Welcome({ navigate }: WelcomeProps) {
  const [openFaq, setOpenFaq] = useState<number | null>(0)

  return (
    <div className="landing" dir="rtl">
      <header className="landing-nav">
        <div className="landing-shell landing-nav-inner">
          <button className="landing-brand brand-link" onClick={() => navigate('/')} aria-label="موزون — الصفحة الرئيسية">
            <img src="/logo_scale.svg" alt="Mawzun" />
            <img src="/mawzun_black.svg" width="270" height="107" alt="" className="brand-wordmark" />
          </button>

          <nav className="landing-nav-links">
            <a href="#features">{t.nav.features}</a>
            <a href="#modules">{t.nav.modules}</a>
            <a href="#how">{t.nav.how}</a>
            <a href="#faq">{t.nav.faq}</a>
            <a href="https://docs.mawzun.org" target="_blank" rel="noreferrer">{t.nav.docs}</a>
            <a href="https://status.mawzun.org" target="_blank" rel="noreferrer">{t.nav.status}</a>
          </nav>

          <div className="landing-nav-actions">
            {/* The source is public, so the header carries it beside the two
                account actions. The icon is inline SVG rather than an <img>
                so it inherits currentColor and needs no extra request. */}
            <a
              className="landing-btn-github"
              href="https://github.com/MohamedAYassin/Mawzun"
              target="_blank"
              rel="noreferrer"
              aria-label="الكود المصدري على GitHub"
              title="الكود المصدري على GitHub"
            >
              <svg viewBox="0 0 16 16" width="17" height="17" aria-hidden="true" focusable="false">
                <path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/>
              </svg>
            </a>
            <button className="landing-btn-ghost" onClick={() => navigate('/login')}>
              {t.login}
            </button>
            <button className="landing-btn" onClick={() => navigate('/register')}>
              {t.start}
            </button>
          </div>
        </div>
      </header>

      <main>
      <section className="landing-hero">
        <div className="landing-shell landing-hero-inner">
          <span className="landing-badge">
            <span className="badge-dot" aria-hidden="true" />
            {t.badge}
          </span>
          <h1>{t.heroTitle}</h1>
          <p className="landing-hero-sub">{t.heroSub}</p>
          <div className="landing-hero-actions">
            <button className="landing-btn landing-btn-lg" onClick={() => navigate('/register')}>
              {t.start}
            </button>
            <button className="landing-btn-outline landing-btn-lg" onClick={() => navigate('/login')}>
              {t.login}
            </button>
            {/* The hero carries the labelled version; the header keeps the
                icon-only one, and only the hero's survives on narrow screens
                (see the 900px breakpoint) so the nav row cannot overflow. */}
            <a
              className="landing-btn-outline landing-btn-lg landing-btn-github-lg"
              href="https://github.com/MohamedAYassin/Mawzun"
              target="_blank"
              rel="noreferrer"
            >
              <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true" focusable="false">
                <path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/>
              </svg>
              الكود المصدري
            </a>
          </div>
          <p className="landing-hero-note">{t.heroNote}</p>

          <div className="hero-stage">
            <div className="hero-floats">
              {floatChips.map((c) => (
                <a key={c.id} className={`hero-float ${c.className}`} href={c.href} target="_blank" rel="noreferrer">
                  <span className="hero-float-icon">
                    <c.icon />
                  </span>
                  <span className="hero-float-text">
                    <span className="hero-float-label">{c.label}</span>
                    {c.sublabel && <span className="hero-float-sub">{c.sublabel}</span>}
                  </span>
                </a>
              ))}
            </div>

            <div className="landing-preview" aria-hidden="true">
            <div className="preview-bar">
              <span />
              <span />
              <span />
            </div>
            <div className="preview-body">
              <div className="preview-side">
                {t.modules.map((m) => (
                  <div key={m.t} className="preview-side-item">
                    {m.t}
                  </div>
                ))}
              </div>
              <div className="preview-main">
                <div className="preview-stats">
                  {t.stats.map((s) => (
                    <div key={s.label} className="preview-stat">
                      <strong>{s.value}</strong>
                      <span>{s.label}</span>
                    </div>
                  ))}
                </div>
                <div className="preview-rows">
                  {[0, 1, 2, 3, 4, 5].map((r) => (
                    <div key={r} className="preview-row" />
                  ))}
                </div>
              </div>
            </div>
            </div>
          </div>
        </div>
      </section>

      <section className="landing-section" id="features">
        <div className="landing-shell">
          <div className="section-head">
            <span className="section-eyebrow">المزايا</span>
            <h2>{t.featuresTitle}</h2>
          </div>
          <div className="landing-grid landing-grid-3">
            {t.features.map((f) => (
              <article key={f.t} className="landing-card">
                <h3>{f.t}</h3>
                <p>{f.d}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="landing-section landing-section-alt" id="modules">
        <div className="landing-shell">
          <div className="section-head">
            <span className="section-eyebrow">الوحدات</span>
            <h2>{t.modulesTitle}</h2>
          </div>
          <div className="landing-grid landing-grid-4">
            {t.modules.map((m, i) => (
              <article key={m.t} className="landing-module">
                <span className="landing-module-num">{String(i + 1).padStart(2, '0')}</span>
                <h3>{m.t}</h3>
                <p>{m.d}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="landing-section" id="how">
        <div className="landing-shell">
          <div className="section-head">
            <span className="section-eyebrow">طريقة العمل</span>
            <h2>{t.howTitle}</h2>
          </div>
          <div className="landing-grid landing-grid-3 landing-steps">
            {t.how.map((s, i) => (
              <article key={s.t} className="landing-step">
                <span className="landing-step-num">{i + 1}</span>
                <h3>{s.t}</h3>
                <p>{s.d}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="landing-section landing-section-alt" id="faq">
        <div className="landing-shell landing-faq">
          <div className="section-head">
            <span className="section-eyebrow">أسئلة شائعة</span>
            <h2>{t.faqTitle}</h2>
          </div>
          <div className="landing-faq-list">
            {t.faq.map((item, i) => (
              <div key={item.q} className={`landing-faq-item ${openFaq === i ? 'open' : ''}`}>
                <button onClick={() => setOpenFaq(openFaq === i ? null : i)}>
                  <span>{item.q}</span>
                  <span className="landing-faq-sign" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  </span>
                </button>
                {openFaq === i && <p>{item.a}</p>}
              </div>
            ))}
          </div>
        </div>
      </section>


      <section className="landing-cta">
        <div className="landing-shell landing-cta-inner">
          <h2>{t.ctaTitle}</h2>
          <p>{t.ctaSub}</p>
          <div className="landing-hero-actions">
            <button className="landing-btn landing-btn-lg" onClick={() => navigate('/register')}>
              {t.start}
            </button>
            <button className="landing-btn-outline landing-btn-lg" onClick={() => navigate('/login')}>
              {t.login}
            </button>
          </div>
        </div>
      </section>

      </main>

      <footer className="landing-footer">
        <div className="landing-shell">
          <div className="foot-grid">
            <div>
              <button className="landing-brand brand-link footer-brand" onClick={() => navigate('/')} aria-label="موزون — الصفحة الرئيسية">
                <img src="/logo_scale.svg" alt="Mawzun" />
              </button>
            </div>
            <nav aria-label="المنتج">
              <h3>المنتج</h3>
              <a href="#features">المزايا</a>
              <a href="#modules">الوحدات</a>
              <a href="#how">كيف يعمل</a>
              <a href="#faq">الأسئلة</a>
            </nav>
            <nav aria-label="الموارد">
              <h3>الموارد</h3>
              <a href="https://docs.mawzun.org" target="_blank" rel="noreferrer">API</a>
              <a href="https://status.mawzun.org" target="_blank" rel="noreferrer">Status</a>
              <a href="https://app.mawzun.org/">تسجيل الدخول</a>
              <a href="/terms">الشروط والأحكام</a>
              <a href="/privacy">سياسة الخصوصية</a>
            </nav>
            <nav aria-label="تواصل">
              <h3>تواصل</h3>
              <a href="mailto:help@mawzun.org">help@mawzun.org</a>
              <a href="mailto:legal@mawzun.org">legal@mawzun.org</a>
            </nav>
          </div>
          <div className="foot-bottom">
            <p>صُنع بـ ❤️ بواسطة <a href="https://yassin.dev" target="_blank" rel="noreferrer">Yassin</a></p>
            <p>© {new Date().getFullYear()} موزون — جميع الحقوق محفوظة.</p>
          </div>
        </div>
      </footer>
    </div>
  )
}

export default Welcome
