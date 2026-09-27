// Last-resort error page, rendered by the custom SSR entry (src/server.ts) when
// the app itself fails to render. It is served as raw HTML — no React, no CSS
// bundle — so it carries its own inline styles, and it must stand alone.
//
// Arabic + RTL, like every other surface in the app: this is the page a user
// sees when something has already gone wrong, so it should not also be the one
// screen that switches language and direction on them.
export function renderErrorPage(): string {
  return `<!doctype html>
<html lang="ar" dir="rtl">
  <head>
    <meta charset="utf-8" />
    <title>تعذّر تحميل الصفحة</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body { font: 15px/1.6 system-ui, -apple-system, "Segoe UI", "IBM Plex Sans Arabic", sans-serif; background: #fafafa; color: #111; display: grid; place-items: center; min-height: 100vh; margin: 0; padding: 1.5rem; }
      .card { max-width: 28rem; width: 100%; text-align: center; padding: 2rem; }
      h1 { font-size: 1.25rem; margin: 0 0 0.5rem; }
      p { color: #4b5563; margin: 0 0 1.5rem; }
      .actions { display: flex; gap: 0.5rem; justify-content: center; flex-wrap: wrap; }
      a, button { padding: 0.5rem 1rem; border-radius: 0.375rem; font: inherit; cursor: pointer; text-decoration: none; border: 1px solid transparent; }
      .primary { background: #111; color: #fff; }
      .secondary { background: #fff; color: #111; border-color: #d1d5db; }
      @media (prefers-color-scheme: dark) {
        body { background: #0b111d; color: #e7edf6; }
        p { color: #9fb0c7; }
        .primary { background: #3b82f6; color: #fff; }
        .secondary { background: #172030; color: #e7edf6; border-color: #26324a; }
      }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>تعذّر تحميل الصفحة</h1>
      <p>حدث خطأ من جانبنا. يمكنك إعادة المحاولة أو العودة للصفحة الرئيسية.</p>
      <div class="actions">
        <button class="primary" onclick="location.reload()">إعادة المحاولة</button>
        <a class="secondary" href="/">العودة للرئيسية</a>
      </div>
    </div>
  </body>
</html>`;
}
