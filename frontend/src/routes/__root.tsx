import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import App from "../App";
import appCss from "../styles.css?url";
import { Toaster } from "../components/ui/sonner";

function NotFoundComponent() {
  return (
    <div dir="rtl" className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">٤٠٤</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">الصفحة غير موجودة</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          الصفحة التي تبحث عنها غير موجودة أو تم نقلها.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            العودة للرئيسية
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
    <div dir="rtl" className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          تعذّر تحميل الصفحة
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          حدث خطأ من جانبنا. يمكنك إعادة المحاولة أو العودة للصفحة الرئيسية.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            إعادة المحاولة
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            العودة للرئيسية
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Mawzun" },
      {
        name: "description",
        content: "Mawzun — inventory, orders, shipping and accounting operations platform.",
      },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Sora:wght@500;600;700&family=Manrope:wght@400;500;600;700&family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&display=swap",
      },
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
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
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  // The session ended or changed hands — either way the cached data belongs to
  // someone else now and has to go.
  //
  // `/auth/me` is cached for 5 minutes and is the source of the principal, the
  // permissions and the onboarding flag. Leaving it in place meant the next
  // person to sign in on this browser saw the previous account's name, company
  // and permissions until the cache expired or the page was reloaded.
  //
  // Two events, not one, because they mean different things:
  //   session-expired — signed out; the app redirects to login.
  //   session-changed — signed in as someone else; the app must NOT redirect.
  // Clearing the cache is the response to both, so both are handled here.
  //
  // This lives in the root route rather than in each caller because there are
  // several ways a session ends or changes (two logout buttons, a refresh
  // failure, the 401 path in the transport, login, signup, impersonation) and
  // a seventh would otherwise forget.
  useEffect(() => {
    const onSessionEnded = () => queryClient.clear();
    window.addEventListener("mawzun:session-expired", onSessionEnded);
    window.addEventListener("mawzun:session-changed", onSessionEnded);
    return () => {
      window.removeEventListener("mawzun:session-expired", onSessionEnded);
      window.removeEventListener("mawzun:session-changed", onSessionEnded);
    };
  }, [queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      {/* App renders <Outlet />, which is where nested routes appear. Removing
          it breaks every child route. */}
      <App />
      <Toaster position="top-left" richColors />
    </QueryClientProvider>
  );
}
