import {
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { type ReactNode } from "react";

import App from "../App";
import appCss from "../styles.css?url";

/** Google Fonts URL. Sora = headings, Manrope = Latin body, IBM Plex Sans
 *  Arabic = the Arabic face. Only the weights the CSS actually uses. */
const FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=Sora:wght@500;600;700&family=Manrope:wght@400;500;600;700&family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&display=swap";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<Record<string, never>>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "موزون | نظام إدارة المبيعات والمخازن والعمليات" },
      {
        name: "description",
        content: "موزون — نظام عربي لإدارة المبيعات والمخازن والشحن والحسابات من لوحة واحدة.",
      },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "موزون" },
      { property: "og:locale", content: "ar_EG" },
      { property: "og:image", content: "https://mawzun.org/og.png" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:image:alt", content: "موزون — لوحة إدارة المبيعات والمخازن" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:image", content: "https://mawzun.org/og.png" },
      { name: "theme-color", content: "#0f172a" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      // Fonts load off the critical path. A plain render-blocking stylesheet here
      // cost ~1.9s of FCP on mobile (Lighthouse "Render-blocking requests"): the
      // browser had to fetch and parse this before painting anything. `media="print"`
      // makes it non-blocking.
      //
      // NOTE: the usual `onload="this.media='all'"` trick does NOT work here —
      // React treats `onload` as an event-handler prop and strips the string, which
      // would leave the sheet stuck on `media="print"` and fonts never loading.
      // The flip is done by a small inline script instead (see `scripts` below).
      { rel: "preload", as: "style", href: FONTS_HREF },
      { rel: "stylesheet", href: FONTS_HREF, media: "print", id: "app-fonts" },
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
    ],
    scripts: [
      {
        // Activates the non-blocking font sheet once it has loaded. Kept inline
        // and tiny so it runs immediately, before first paint.
        children: `(function(){var l=document.getElementById("app-fonts");if(!l)return;if(l.sheet)l.media="all";else l.addEventListener("load",function(){l.media="all"});})();`,
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    // Arabic-first app. The server renders the same lang/dir the client sets
    // in App's direction effect; a mismatch here made React discard the whole
    // hydrated tree on /login, which remounted the page and wiped the login
    // form mid-typing.
    <html lang="ar" dir="rtl">
      <head>
        <HeadContent />
        {/* No-JS fallback for the async font stylesheet above. */}
        <noscript>
          <link rel="stylesheet" href={FONTS_HREF} />
        </noscript>
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  return (
    /* App renders <Outlet />, which is where nested routes appear. Removing
       it breaks every child route. */
    <App />
  );
}
