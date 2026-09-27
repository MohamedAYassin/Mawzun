// Custom TanStack Start server entry.
//
// Kept as a custom entry (not the default) because vite.config.ts pins
// `tanstackStart.server.entry = "server"`, which the prerender preview shim
// depends on: the shim writes `server.js` into dist/server, and an entry named
// `index` would outrank nitro's own entry when publishing.
//
// This is a static marketing landing: no server functions, no loaders, no data
// fetching. The only failure mode is a framework-level throw, so this is a
// plain last-resort page — no error-recovery machinery.

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

const FALLBACK_PAGE = `<!doctype html>
<html lang="ar" dir="rtl">
  <head>
    <meta charset="utf-8" />
    <title>تعذر تحميل الصفحة | موزون</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body { font: 15px/1.7 system-ui, -apple-system, sans-serif; background: #fafafa; color: #111; display: grid; place-items: center; min-height: 100vh; margin: 0; padding: 1.5rem; }
      .card { max-width: 28rem; width: 100%; text-align: center; padding: 2rem; }
      h1 { font-size: 1.25rem; margin: 0 0 0.5rem; }
      p { color: #4b5563; margin: 0 0 1.5rem; }
      a { display: inline-block; padding: 0.5rem 1rem; border-radius: 0.375rem; background: #111; color: #fff; text-decoration: none; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>تعذر تحميل الصفحة</h1>
      <p>حدث خطأ غير متوقع. يمكنك المحاولة مرة أخرى أو العودة إلى الصفحة الرئيسية.</p>
      <a href="/">العودة للرئيسية</a>
    </div>
  </body>
</html>`;

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const handler = await getServerEntry();
      return await handler.fetch(request, env, ctx);
    } catch (error) {
      console.error(error);
      return new Response(FALLBACK_PAGE, {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
