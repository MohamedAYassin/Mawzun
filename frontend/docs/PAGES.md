# Mawzun Dashboard — Every Page, Every Element
`app.mawzun.org` · frontend (TanStack Start, RTL Arabic) + Backend (Express, `/api/v1`).
Generated from code + live browser verification. UI labels quoted in Arabic.

## Live verification (browser, seeded owner)
- Login with `owner@mawzun.local` → lands `/dashboard/sales-overview`, token in `localStorage`.
- Shell renders 8 nav groups: لوحة التحكم، المبيعات، المخزون، المشتريات، التجهيز والشحن، المالية، البيانات الأساسية، الإضافات، الإعدادات.
- Roles page live at `/access?tab=roles` with working tabs (الأدوار/الصلاحيات) and add/edit/delete buttons.
- Global rules: every `_app` screen needs a token (`SessionGate` → `GET /auth/me`); 401 → refresh once via HttpOnly cookie, else `/login`; 403 → «صلاحية مرفوضة» modal. API base `/api/v1`, envelope `{success,message,data}`.

## Auth, public pages & app shell

> Frontend: `frontend/src` · Backend: `api/src` (prefix `/api/v1`). All screens RTL (`<html lang="ar" dir="rtl">`, `__root.tsx` `RootShell` + `App.tsx` `useDocumentDirection`). `navigate(path)` = TanStack Router navigate via `lib/navigation.ts` `usePageNavigate` (splits `?tab=`/`?redirect=`); screens receive it as prop via `lib/pageRoute.ts` `asRoute()`.

### Route guards & root

| Route file | URL | Guard | Behaviour |
|---|---|---|---|
| `routes/__root.tsx` | all | — | `RootShell` renders `<html lang="ar" dir="rtl">` + `<HeadContent/>`/`<Scripts/>`; `RootComponent` wraps `App` in `QueryClientProvider` + `<Toaster position="top-left">`. `notFoundComponent` (EN "404 / Page not found" + `Link to="/"`: "Go home"); `errorComponent` ("This page didn't load" + button "Try again" → `router.invalidate(); reset()` + link "Go home"). |
| `routes/index.tsx` (`/`) | `/` | none (`beforeLoad` deliberately absent; prerendered static `index.html`) | `RootRedirect`: client `useEffect` → `window.location.replace(session.isAuthenticated ? "/dashboard/sales-overview" : "/login")`. Placeholder text "جارٍ التحويل…". `session.isAuthenticated` = `localStorage["mawzun.accessToken"]` present (`lib/api/http.ts`). |
| `routes/_public/route.tsx` | pathless layout for all below | `beforeLoad`: if `session.isAuthenticated` → `redirect({ to: "/dashboard/sales-overview" })` (logged-in users can never see login/register forms) | renders `<Outlet/>` only. |
| `routes/_public/login.tsx` | `/login` | inherits `_public` guard | `asRoute(Login)`. |
| `routes/_public/register.tsx` | `/register` | inherits `_public` guard | `asRoute(Register)`. |
| `routes/_public/signup.tsx` | `/signup` | — | No component: `beforeLoad` → `redirect({ to: "/register" })`. Legacy alias only. |
| `routes/_public/forgot-password.tsx` | `/forgot-password` | inherits `_public` guard | `asRoute(ForgotPassword)`. |
| `routes/_public/reset-password.tsx` | `/reset-password?token=…` | inherits `_public` guard | `asRoute(ResetPassword)`. Token comes from owner email link (`passwordReset.service.ts`: `${APP_ORIGIN}/reset-password?token=…`, 24 h, single-use). |
| `routes/_app/route.tsx` | pathless layout for all company screens | `beforeLoad`: if `!session.isAuthenticated` → `redirect({ to: "/login", search: { redirect: location.href } })` (deep link preserved) | `AppLayout` = `<SessionGate><Outlet/></SessionGate>`. |
| `routes/_app/change-password.tsx` | `/change-password` | inherits `_app` guard + `SessionGate` | `asRoute(ChangePassword)` (ChangePassword renders its own `DashboardLayout`). |
| `routes/$.tsx` | any unknown path | — (`head`: `robots=noindex`) | `asRoute(NotFound)` (Arabic 404; root `notFoundComponent` only fires on `notFound()` throws). |
| `App.tsx` (global, all routes) | — | listeners | `mawzun:session-expired` → `navigate("/login")`; `forbidden-action` event → modal "صلاحية مرفوضة" + server message + button "حسناً، فهمت" (dismiss). Theme from `localStorage["theme"]` applied to `documentElement.dataset.theme`. |

### `components/guards/SessionGate.tsx` (company-shell gate, mounted once by `_app/route.tsx`)

Source of truth: `useCurrentUser()` → `GET /api/v1/auth/me` (`authApi.me()`, `enabled` only when token exists, `retry:false`, 5-min stale). States:
- `!session.isAuthenticated` or 401 `ApiError` (transport already cleared tokens + fired `mawzun:session-expired`) → spinner "جاري تسجيل الخروج..." + `router.navigate({ to:"/login" })`.
- 403 `ApiError` (only cause: company `SUSPENDED`/`CLOSED` per `middleware/authenticate`) → `Blocked` card: title "تعذّر الوصول إلى الشركة", server message, button "تسجيل الخروج" → `authApi.logout(true)` then `/login`.
- other error → `Blocked`: "تعذّر تحميل الحساب" + button "إعادة المحاولة" → `router.invalidate()`.
- loading → spinner "جاري تحميل بيانات الحساب...".
- `principal.user.isPlatformAdmin` (no company) → `<Navigate to="/platform/companies">`.
- else renders children.

### Pages

#### `pages/Login/Login.tsx` — `/login` — "تسجيل الدخول"
Purpose: sign in with email+password.
- Input `البريد الإلكتروني` (`#email`, `type=email`, required): `setEmail`.
- Input `كلمة المرور` (`#password`, `type=password`, required): `setPassword`.
- Checkbox `تذكرني`: `setRememberMe` → passed as `rememberMe` in login body (controls refresh-cookie lifetime server-side).
- Button `نسيت كلمة المرور؟` (`type=button`, `.forgot-btn`): `navigate("/forgot-password")`.
- Submit `تسجيل الدخول` (→ "جاري التحميل..." while loading): `handleLoginSubmit` → `POST /api/v1/auth/login` (`authApi.login({email,password,rememberMe})`) → stores `accessToken` in `localStorage`, refresh token stays HttpOnly cookie → reads `?redirect=`; `navigate(target)` if starts with `/` and not `/login`, else `navigate("/dashboard")`. Failure → inline `.login-error-message` (server Arabic message or "فشل تسجيل الدخول. يرجى التحقق من بيانات الاعتماد والمحاولة مرة أخرى.").
- Button `ليس لديك حساب؟ أنشئ مساحة عمل جديدة`: `navigate("/register")`.
- Visual pane (no handler): heading "نظام ERP متكامل لإدارة مبيعاتك ومخزونك وعملياتك", footer "من المبيعات والمخزون إلى الإنتاج والشحن والمحاسبة: كل عمليات مؤسستك في مكان واحد."
- Guards: `_public` (authenticated bounced to `/dashboard/sales-overview`).

#### `pages/Register/Register.tsx` — `/register` (and `/signup` → redirect) — "إنشاء حساب جديد"
Purpose: create company + owner account in one call.
- Inputs: `اسم الشركة / النشاط` (placeholder "مثال: متجر النور"), `الاسم الكامل`, `البريد الإلكتروني` (`type=email`), `رقم الهاتف (اختياري)`, `كلمة المرور` (`minLength=6`), `تأكيد كلمة المرور`. All `setX` state; client check `password !== confirmPassword` → error "كلمتا المرور غير متطابقتين." (no API call).
- Submit `إنشاء الحساب والبدء` (→ "جاري إنشاء الحساب..."): `POST /api/v1/auth/signup` (`authApi.signup({companyName,fullName,email,password,phoneNumber})`; caller becomes single company owner) → `navigate("/dashboard")`. Failure → `.auth-error` (server message or "تعذر إنشاء الحساب.").
- Link `تسجيل الدخول` (`لديك حساب بالفعل؟`): `preventDefault` + `navigate("/login")`.
- Guards: `_public` only (no permission; unauthenticated by definition).

#### `pages/ForgotPassword/ForgotPassword.tsx` — `/forgot-password` — "استعادة كلمة المرور"
Purpose: owner-first recovery; tenants are diverted to their owner before submit.
- Input `البريد الإلكتروني` (`#fp-email`, LTR): on change/blur → `checkEmail()` → `POST /api/v1/auth/forgot-password/check` returns `{accountKind: 'owner'|'tenant'|'unknown', message}`. `tenant` → info notice with server message + static box "هذا الحساب **داخل شركة** — إعادة تعيين كلمة المرور تتم من مالك الشركة أو مدير لديه صلاحية المستخدمين، من شاشة المستخدمين."; submit disabled while `isTenant`.
- Phases: `idle→checking→ready→sending→sent`. Submit `إرسال رابط إعادة التعيين` (→ "جاري الإرسال…", disabled unless email regex valid, not checking/sending, not tenant): `POST /api/v1/auth/forgot-password` (owner → reset email, tenant/unknown → generic no-email response) → `sent`: owner notice "إذا كان الحساب مؤهلاً، فستصلك رسالة على بريدك الإلكتروني تحتوي على رابط إعادة التعيين خلال دقائق. الرابط صالح ٢٤ ساعة."; tenant notice = server message (`kind:info`). Failure → error notice.
- Buttons: tenant-only `فهمت — العودة إلى تسجيل الدخول` → `/login`; standard `العودة إلى تسجيل الدخول` → `/login` (disabled while tenant pre-send; after `sent` becomes primary `.btn-submit`); `ليس لديك حساب؟ أنشئ مساحة عمل جديدة` → `/register`.
- Guards: `_public` only.

#### `pages/ResetPassword/ResetPassword.tsx` — `/reset-password?token=…` — "تعيين كلمة مرور جديدة"
Purpose: consume emailed token, set new password.
- No-token branch: title "رابط غير صالح", subtitle "لا يوجد رمز إعادة تعيين في الرابط.", button `طلب رابط جديد` → `navigate("/forgot-password")`.
- Inputs: `كلمة المرور الجديدة` (`#rp-pass`), `تأكيد كلمة المرور` (`#rp-confirm`). Client checks: `<8` chars → "كلمة المرور يجب ألا تقل عن ٨ أحرف."; mismatch → "كلمتا المرور غير متطابقتين." (no API call).
- Submit `تعيين كلمة المرور` (→ "جاري الحفظ…"): `POST /api/v1/auth/reset-password` (`authApi.resetPassword(token,newPassword)`) → success notice "تم تعيين كلمة المرور بنجاح. يمكنك تسجيل الدخول الآن." + `setTimeout(() => navigate("/login"), 1800)`. Failure → server message or "تعذر تعيين كلمة المرور."
- Button `العودة إلى تسجيل الدخول` → `/login`.
- Guards: `_public` only.

#### `pages/ChangePassword/ChangePassword.tsx` — `/change-password` (inside `DashboardLayout`) — "تغيير كلمة المرور"
Purpose: authenticated password rotation (kills other sessions).
- Inputs: `كلمة المرور الحالية` (placeholder "أدخل كلمة المرور الحالية"), `كلمة المرور الجديدة`, `تأكيد كلمة المرور الجديدة`. Client checks: empty → "يرجى ملء جميع الحقول."; new `<6` → "يجب أن تكون كلمة المرور الجديدة مكونة من ٦ أحرف على الأقل."; mismatch → "كلمة المرور الجديدة وتأكيدها غير متطابقين."
- Submit `تغيير كلمة المرور` (→ "جاري التحديث..."): `POST /api/v1/auth/change-password` with Bearer (`authApi.changePassword({currentPassword,newPassword})`; server rotates security stamp, returns fresh token pair which replaces stored access token) → success "تم تغيير كلمة المرور بنجاح، وتم تسجيل الخروج من باقي الأجهزة." + clears fields; stays on page. Failure → server message inline.
- Guards: `_app beforeLoad` (token) + `SessionGate` (`/auth/me` + company status); no separate permission (any signed-in company user).

#### `pages/NotFound/NotFound.tsx` — catch-all — "الصفحة غير موجودة"
Purpose: Arabic 404 for unknown URLs. Elements: code "٤٠٤" (`toArabicNumerals('404')`), message "الرابط الذي تحاول الوصول إليه غير صالح أو تم نقله. يرجى العودة إلى الصفحة الرئيسية.", single button `العودة للرئيسية` → `navigate("/")` (which re-runs the `/` smart redirect). No API, no guard.

### App shell (`components/DashboardLayout/`)

#### `DashboardLayout.tsx` — wraps every `_app` screen (and ChangePassword directly)
- State: `sidebarOpen` (mobile drawer), `isCollapsed` (desktop, persisted `localStorage["sidebar_collapsed"]`), `commandOpen` (`Ctrl/⌘+K` toggles).
- `handleLogout` (shared by Sidebar + TopBar): `await authApi.logout(true)` → `POST /api/v1/auth/logout { allSessions:true }` with `skipRefresh:true` (server revokes cookie session(s)) — failure still continues — then `navigate("/login")`. Local tokens cleared in `finally` (`session.clear()`).
- Layout: `<Sidebar/>` + `<div.layout-main>` (`<TopBar/>`, `<ModuleTabs/>`, `<PageTabs/>`, `<main.layout-content>{children}</main>`) + `<CommandPalette/>`.

#### `Sidebar.tsx` — `القائمة الرئيسية`
- Data: `navModules` from `navConfig.tsx`; active module/item via `resolveActive(normalizePath(usePathname()))`; permission filter: modules with `permission` hidden unless `useCurrentUser().hasPermission()` (`Permissions.ViewVendors`, `Permissions.ViewStores`, `Permissions.ManageSettings`; backend re-enforces per request).
- Module buttons (`#sidebar-module-<id>`): expanded mode toggles accordion (`openModule`, follows active route); collapsed mode navigates to module's first item. Chevron rotates; `title` tooltip when collapsed.
- Item buttons (`#sidebar-menu-item-<slug>`): `navigate(item.path)` + close mobile drawer; active item highlighted.
- Footer profile: avatar (server `principal.user.avatarUrl` or initials) + name/email from `principal` (never localStorage). Click toggles menu: `تغيير كلمة المرور` → `/change-password`; `إعدادات النظام` → `/system-settings`; `تسجيل الخروج` (`.danger` + icon) → `onLogout` (see logout flow). Outside click closes. Mobile backdrop `#sidebar-backdrop` → `onClose`.

#### `TopBar.tsx`
- Start: hamburger `Toggle Sidebar` (`PanelLeftIcon`) → `onToggleSidebar` (desktop collapses, mobile opens drawer); breadcrumb `<span.topbar-breadcrumb>` from hardcoded path map, e.g. "لوحة الإحصائيات / المبيعات" (`/dashboard/sales-overview`), "الطلبات / سجل الطلبات", "المخازن / إدارة المخازن", "الاعدادات / المستخدمين", "تغيير كلمة المرور", default "لوحة الإحصائيات".
- Theme button (`aria-label/title` "تبديل المظهر (فاتح/داكن)"): toggles `documentElement.dataset.theme` + `localStorage["theme"]`. No API.
- `NotificationBell` (label/title "الإشعارات"): on mount + every 60 s + on open: `GET /api/v1/system/notifications/unread-count` + `GET /api/v1/system/notifications?pageSize=10`. Badge = unread count (99+ capped). Dropdown header: "الإشعارات (N جديدة)" + `تعليم الكل كمقروء` → `POST /system/notifications/read-all`. Empty: "لا توجد إشعارات بعد". Row click → `POST /system/notifications/:id/read` (if unread) then `navigate(item.link)` (server-provided deep link). `✕` per row (`حذف إشعار <title>`/`حذف الإشعار`) → `DELETE /system/notifications/:id`. Category chip Arabic: `عام`/`طلبات`/`مخزون`/`فواتير`/`النظام`; timestamps `ar-EG`; read time "قُرئ …". Failures silent.
- User menu: avatar button toggles dropdown showing name/email; items: `الإعدادات` → `/system-settings`; `تغيير كلمة المرور` → `/change-password`; `تسجيل الخروج` → `onLogout`. Outside click closes.

#### `navConfig.tsx` — all nav destinations (sidebar + ModuleTabs + palette)
- `home` "لوحة التحكم": `/dashboard/sales-overview` "ملخص المبيعات", `/dashboard/inventory-overview` "ملخص المخازن", `/dashboard/accounting-overview` "ملخص المحاسبة", `/dashboard/reports` "التقارير".
- `sales` "المبيعات": `/dashboard/add-sale` "إضافة مبيعات", `/dashboard/orders` "سجل الطلبات", `/dashboard/confirmation-overview` "تأكيد الطلبات", `/dashboard/customers` "العملاء", `/dashboard/coupons` "رموز الخصم", `/dashboard/order-sources` "مصادر الطلبات", `/dashboard/orders-transactions` "حركات البيع".
- `inventory` "المخزون": `/dashboard/products` "المنتجات", `/dashboard/add-product` "إضافة منتج", `/dashboard/product-family` "الخصائص والمتغيرات", `/dashboard/product-stocks` "أرصدة المنتجات", `/dashboard/inventory-transactions` "حركات التخزين", `/dashboard/add-inventory-transaction` "تسجيل حركة", `/dashboard/warehouses` "المخازن", `/dashboard/storage-locations` "مواقع التخزين", `/dashboard/inventory-adjustment` "الجرد الفعلي", `/dashboard/inventory-transfers` "تحويلات المخزون", `/dashboard/stock-counts` "جرد المخزون", `/dashboard/alerts` "تنبيهات المخزون".
- `purchasing` "المشتريات" (gate `Permissions.ViewVendors`): `/dashboard/purchase-orders` "أوامر الشراء", `/dashboard/vendors` "الموردون", `/dashboard/consignment-vendors` "موردو الأمانة", `/dashboard/supplier-overview` "ملخص الموردين", `/dashboard/stock-operations` "حركات المخزون", `/dashboard/purchase-transactions` "حركات الشراء".
- `fulfillment` "التجهيز والشحن": `/dashboard/fulfillment-lists` "قوائم التجهيز والتغليف", `/dashboard/production` "الباتشات", `/dashboard/add-batch` "إنشاء باتش", `/dashboard/scanning` "المسح الضوئي", `/dashboard/scanner-transactions` "سجل المسح", `/dashboard/shipping-overview` "عمليات الشحن", `/dashboard/shipping-companies` "شركات الشحن", `/dashboard/returns` "المرتجعات والاستبدال".
- `directory` "البيانات الأساسية": `/dashboard/directory` "البيانات المرجعية", `/dashboard/stores` "المتاجر المربوطة", `/dashboard/payment-methods` "طرق الدفع".
- `apps` "الإضافات" (gate `Permissions.ViewStores`): `/dashboard/apps` "الإضافات والربط".
- `settings` "الإعدادات" (gate `Permissions.ManageSettings`): `/system-settings` "إعدادات النظام", `/users` "المستخدمون", `/access` "الأدوار والصلاحيات", `/dashboard/api-keys` "المفاتيح البرمجية", `/dashboard/integrations` "شركات الشحن", `/dashboard/sync-errors` "أخطاء المزامنة", `/change-password` "تغيير كلمة المرور".
- Helpers: `resolveActive()` (exact/prefix match; `/dashboard` aliases `/dashboard/sales-overview`); `pageTabGroups` (merged screens, `?tab=`): `/dashboard/alerts` ("تنبيهات النقص" `low-stock`, "عجز المخزون" `deficits`), `/dashboard/fulfillment-lists` ("سلال السحب" `picking`, "صناديق التغليف" `packing`), `/dashboard/returns` ("استلام المرتجعات" `shipments`, "طلبات الإرجاع" `requests`, "طلبات الاستبدال" `exchanges`), `/dashboard/directory` ("الماركات" `brands`, "الأقسام" `categories`, "وحدات القياس" `uom`, "الأسباب" `reasons`, "المحافظات" `governorates`, "المدن" `cities`), `/access` ("الأدوار" `roles`, "الصلاحيات" `permissions`); `mergedRedirects` keep old paths alive (e.g. `/dashboard/low-stock` → `/dashboard/alerts?tab=low-stock`, `/roles` → `/access?tab=roles`).

#### `ModuleTabs.tsx` / `PageTabs.tsx` / `CommandPalette.tsx`
- `ModuleTabs`: heading (active module icon + label) + one tab per `module.items` (active highlighted; click → `navigate(entry.path)`) + `بحث سريع` button (`Ctrl K` kbd) → opens palette. Renders null when no module matches.
- `PageTabs`: renders only for `pageTabGroups[current]`; tabs navigate to `` `${current}?tab=${key}` `` (`role=tab`, `aria-selected`); default = first tab.
- `CommandPalette` (`Ctrl/⌘+K` or `بحث سريع`): modal (`role=dialog`) with input placeholder "ابحث عن أي شاشة… (مثال: الطلبات، المخازن، الأدوار)", filters `allNavItems` by label/module/path (max 40), `↑/↓` + `Enter` / hover + click → `navigate(path)`; `Esc`/overlay click closes; empty: "لا توجد نتائج مطابقة". No API.

### Backend endpoints touched (all verified in `api/src`)
- `POST /api/v1/auth/signup` — Register submit (201).
- `POST /api/v1/auth/login` — Login submit.
- `POST /api/v1/auth/refresh` — automatic 401 retry via HttpOnly cookie (not a UI button).
- `POST /api/v1/auth/forgot-password/check` — ForgotPassword live check.
- `POST /api/v1/auth/forgot-password` — ForgotPassword submit.
- `POST /api/v1/auth/reset-password` — ResetPassword submit.
- `POST /api/v1/auth/logout` (+`{allSessions:true}` from shell logout) — Sidebar/TopBar/SessionGate.
- `GET /api/v1/auth/me` — SessionGate + `useCurrentUser` identity/permissions.
- `POST /api/v1/auth/change-password` — ChangePassword submit.
- `GET /api/v1/system/notifications`, `GET /api/v1/system/notifications/unread-count`, `POST /api/v1/system/notifications/:id/read`, `POST /api/v1/system/notifications/read-all`, `DELETE /api/v1/system/notifications/:id` — TopBar bell.
- Transport: `Bearer` access token + `credentials:include` (refresh cookie); dev via `/api/public/proxy` relay, prod `https://api.mawzun.org`; envelope `{success,message,data}`; 401 → single shared refresh then retry, else clear + `mawzun:session-expired`.

## Sales

Backend contract: `api/src/modules/sales/` (`sales.routes.ts` mounts `/customers`, `/orders`, `/coupons`, `/order-sources`, `/payment-methods`, `/cancel-reasons`, `/fulfillment-batches`, `/shipping-returns` under `/sales`; geography/carriers in `modules/shipping/shipping.routes.ts`). Frontend: `lib/api/sales.ts`, `shipping.ts`, `reports.ts`. Order statuses: `NEW / CONFIRMED / POSTPONED / CANCELLED / NO_ANSWER / DELIVERED / RETURNED / NOT_DELIVERED / ON_THE_WAY / RETURNED_TO_WAREHOUSE`. Backend transition rules (`POST /:id/status`): same-status change rejected; `CANCELLED` terminal; `DELIVERED` terminal from this endpoint (returns flow instead); `CANCELLED` requires `cancelReasonId`. Guards: no sales page references `Permissions.*`; only gate is `_app beforeLoad` + `SessionGate`. Backend per-endpoint: orders `ViewOrders`/`CreateOrder`/`UpdateOrder`/`DeleteOrder`; fulfillment `ViewFulfillment`/`ManageFulfillment`; shipping-returns `ViewShippingReturns`/`ManageShippingReturns`.

### 1. SalesOverview — `/dashboard/sales-overview` (`pages/SalesOverview/SalesOverview.tsx`)
Purpose: read-only sales KPI dashboard (net/gross revenue, averages, trends, mix).
- On mount `loadData()` fires 9 parallel reads: `GET /reports/overview/orders`, `GET /reports/orders/graph?days=180`, `GET /reports/orders/top-products?top=5`, `GET /reports/orders/source-distribution`, `GET /reports/orders/totals`, `GET /reports/orders/top-employees?top=1`, `GET /reports/orders/status-distribution`, `GET /reports/orders/top-categories?top=5`, `GET /reports/orders/top-return-reasons?top=5`. Failure swallowed, `loading` cleared.
- Button «تحديث البيانات» → re-runs `loadData()`. Button «طلب بيع جديد» → `navigate("/dashboard/add-sale")`.
- Segment «القيمة»/«الطلبات» (`trendTab`) → switches area chart between `value` (ج.م) and `count` (طلب), local state only.
- Segment «أفضل المنتجات»/«مصادر الطلبات»/«الحالات»/«الفئات»/«أسباب المرتجعات» (`mixTab`) → switches donut chart dataset, local state only.
- Status labels: جديد/مؤكد/مؤجل/ملغي/لا يرد/تم التسليم/مرتجع/لم يُسلّم/في الطريق/رُجع للمخزن. No writes, no modals, no navigation besides add-sale.

### 2. OrderManagement — `/dashboard/orders` (`pages/OrderManagement/OrderManagement.tsx`; child invoice nests via `<Outlet/>`)
Purpose: paginated register of `type=SALE` orders with expandable detail, invoice link, delete.
- On mount/page/search/status change: `GET /sales/orders?page&pageSize=10&type=SALE&search?&status?`.
- Input «بحث برقم الطلب أو اسم العميل أو الهاتف...» → `setSearch`, page 1, refetch.
- Status select («كل الحالات», جديد/تم التأكيد/مؤجل/ملغي/لم يرد/تم التسليم/مرتجع/لم يتم التوصيل/في الطريق/تم الإرجاع للمخزن) → `setStatusFilter`, page 1, refetch.
- Row click (▸/▾) → expands; lazy `GET /sales/orders/:id` once per row: «معلومات الطلب» (رقم الطلب، تاريخ الإنشاء، النوع، الحالة، مصدر الطلب، طريقة الدفع، رقم طلب المتجر)، «معلومات العميل»، «الشحن والتوصيل» (شركة الشحن، تكلفة الشحن، المستودع)، «التسعير والخصم» (العملة، سعر الطلب، نسبة الخصم، كوبون، قيمة الخصم، السعر الفعلي)، «ملاحظات»، «الجدول الزمني» (أُنشئ/أُكد/شُحن/سُلّم/أُلغي، دفعة التصنيع، الطلب الأصل، طلبات مشتقة)، «سبب الإلغاء» when CANCELLED، products table (المنتج/الكمية/الكمية المؤكدة/سعر الوحدة/الإجمالي/الخصم/الصافي/حالة التصنيع «يحتاج تصنيع»/«متوفر»). Shortage badge «⚠️ عجز مخزون» when `hasShortage`.
- Button «فاتورة» per row → `navigate("/dashboard/orders/${id}/invoice")`.
- Button «حذف» per row → `window.confirm("هل أنت متأكد من حذف الطلب رقم …؟")` → `DELETE /sales/orders/:id` → reload.
- Pagination «السابق»/«التالي» («الصفحة … من … (… طلب)»).

### 3. OrderInvoice — `/dashboard/orders/$orderId/invoice` (`pages/OrderInvoice/OrderInvoice.tsx`)
Purpose: printable A4 invoice sheet; server-computed totals, nothing computed client-side.
- On mount: `GET /sales/orders/:id/invoice` → company header (name/address/phone/email)، «فاتورة» + orderNumber + date + Arabic status، customer («العميل») + warehouse («المخزن»)، items table (الصنف/SKU/الكمية/السعر/الخصم/الإجمالي)، totals (المجموع الفرعي، الشحن if >0، خصم الطلب (% ) if >0، كوبون … «مُطبّق» if present، الإجمالي).
- Button «رجوع للطلبات» → `navigate('/dashboard/orders')`. Button «طباعة / PDF» → `window.print()` (disabled until loaded). Error shown inline on fetch failure.

### 4. AddSale — `/dashboard/add-sale` (`pages/AddSale/AddSale.tsx`)
Purpose: 4-step wizard («معلومات العميل»، «تفاصيل الطلب»، «المنتجات»، «مراجعة») creating a SALE order; draft in `localStorage['formDraft_addSale']`.
- On mount loads: `GET /shipping/governorates`, `GET /inventory/warehouses`, `GET /sales/order-sources`, `GET /sales/payment-methods`, `GET /shipping/carriers?pageSize=100`, `GET /catalog/products?isActive&pageSize=200`; then `GET /shipping/governorates/:govId/cities?pageSize=200`. First items preselected; first product pre-added as 1×qty row.
- Step 0: «اسم العميل *»، «رقم الهاتف الأساسي *» (both required for «التالي»)، «رقم الهاتف الاحتياطي»، «المحافظة» (→ refetches cities, resets city)، «المدينة»، «العنوان بالتفصيل».
- Step 1: «مستودع الصرف»، «مصدر الطلب»، «طريقة الدفع»، «شركة الشحن»، «تكلفة الشحن (ج.م)» (default 50)، «نسبة الخصم الإجمالي (%)»، «كود الخصم (اختياري)»، «ملاحظات إضافية».
- Step 2: «+ إضافة منتج» appends row (first catalog product, qty 1, catalog price); per-row «المنتج» (changing resets unit price)، «الكمية»، «سعر الوحدة» (disabled)، «خصم %»، «حذف». Gate: ≥1 item to proceed.
- Step 3 «مراجعة الطلب»: read-only recap; «السابق» / «التالي» (completed step circles jump back).
- Final «تسجيل الطلب» → `POST /sales/customers/find-or-create` (by phone) then `POST /sales/orders` (`type:'SALE'`, customer/governorate/city/warehouse/source/payment/carrier ids, shippingCost, discountPercentage, couponCode, detailedAddress, notes, items). Success «تم تسجيل طلب المبيعات بنجاح.» → clears draft, resets to step 0. Stays on page.

### 5. CustomersManagement — `/dashboard/customers` (`pages/CustomersManagement/CustomersManagement.tsx`)
Purpose: customer master data + per-customer order history. Title «العملاء (Customers)».
- On mount: `GET /sales/customers?pageSize=200`. Count «… عميل». «تحديث» → reload. «إضافة عميل» → editor.
- Search «ابحث بالاسم أو رقم الهاتف...» → client-side filter on name/phone1/phone2.
- Table: #/الاسم/الهاتف الأساسي/هاتف إضافي/البريد/الطلبات/الحالة/الإجراءات. «… طلب» per row → expands, lazy `GET /sales/customers/:id/orders` (cached): رقم الطلب/الحالة/التاريخ/الإجمالي, or «لا توجد طلبات لهذا العميل.». Status badge («عميل نشط» checkbox in form).
- Editor: «اسم العميل»، «رقم الهاتف الأساسي» (both required)، «رقم هاتف إضافي»، «البريد الإلكتروني»، «العنوان»، «ملاحظات»، «عميل نشط». Submit → `POST /sales/customers` («تمت إضافة العميل بنجاح.») or `PATCH /sales/customers/:id` («تم تحديث بيانات العميل بنجاح.»). Row edit (pencil) / delete (trash → confirm → `DELETE /sales/customers/:id` → «تم حذف العميل بنجاح.»).

### 6. CouponsManagement — `/dashboard/coupons` (`pages/CouponsManagement/CouponsManagement.tsx`)
Purpose: discount codes consumed at order creation.
- On mount: `GET /sales/coupons?pageSize=200`. Count «… رمز». «تحديث» → reload. «إضافة رمز» → editor.
- Search «ابحث برمز الخصم...» → client-side filter on code.
- Table: #/الرمز/الخصم (badge `%` or `… ج`)/الحد الأدنى/الاستخدام (`redemptionCount[/maxRedemptions]`)/الطلبات (`_count.orders`)/الانتهاء/الحالة/الإجراءات.
- Editor: «الرمز» (uppercased, LTR, e.g. SUMMER10)، «النوع» («نسبة مئوية %»/«مبلغ ثابت»)، «النسبة (0-100)»/«المبلغ»، «الحد الأدنى للطلب (اختياري)»، «أقصى عدد استخدامات (اختياري)»، «تاريخ الانتهاء (اختياري)» (end-of-day ISO)، «مفعّل». Validation: code required («يرجى إدخال رمز الخصم.»)، value >0 («أدخل قيمة خصم صالحة.»)، percentage ≤100 («النسبة لا تتجاوز 100%.»). Submit → `POST /sales/coupons` («تم إنشاء رمز الخصم.») or `PATCH /sales/coupons/:id` («تم تحديث رمز الخصم.»). Delete → confirm («حذف رمز الخصم …؟ الطلبات القديمة تحتفظ بالخصم.») → `DELETE /sales/coupons/:id`.

### 7. OrderSourcesManagement — `/dashboard/order-sources` (`pages/OrderSourcesManagement/OrderSourcesManagement.tsx`, `embedded`-capable)
Purpose: sales channels lookup («مصادر الطلبات»).
- On mount `GET /sales/order-sources` (bare array). Count «… مصادر طلبات». «تحديث» → reload. «إضافة مصدر طلب» → editor («إضافة مصدر طلب»/«تعديل مصدر طلب»).
- Search «ابحث في مصادر طلبات...» → client-side. Columns #/الاسم/الحالة/الإجراءات.
- Editor: «الاسم» (e.g. «مثال: فيسبوك أو الموقع الإلكتروني») + «نشط». Submit → `POST`/`PATCH /sales/order-sources` («تمت إضافة مصدر طلب بنجاح.»/«تم تحديث مصدر طلب بنجاح.»). Delete → confirm → `DELETE /sales/order-sources/:id`. No navigation.

### 8. PaymentMethodsManagement — `/dashboard/payment-methods` (`pages/PaymentMethodsManagement/PaymentMethodsManagement.tsx`, `embedded`-capable; also linked from البيانات الأساسية «طرق الدفع»)
Purpose: tender-type lookup («طرق الدفع»). Same shape as order sources.
- `GET /sales/payment-methods`. Count «… طرق دفع». Search «ابحث في طرق الدفع...». Editor «الاسم» (e.g. «مثال: الدفع عند الاستلام»، required «يرجى إدخال اسم طريقة الدفع.») + «نشط». Submit → `POST`/`PATCH /sales/payment-methods` («تمت إضافة طريقة الدفع بنجاح.»/«تم تحديث طريقة الدفع بنجاح.»). Delete → confirm → `DELETE /sales/payment-methods/:id`.

### 9. ReasonsManagement — canonical `/dashboard/directory?tab=reasons`; legacy `/dashboard/reasons` redirects (`pages/ReasonsManagement/ReasonsManagement.tsx`)
Purpose: cancel-reason lookup («أسباب الإلغاء») feeding the cancel modal in ConfirmationOverview.
- `GET /sales/cancel-reasons`. Count «… أسباب إلغاء». «تحديث» → reload. «إضافة سبب إلغاء» → editor («إضافة سبب إلغاء»/«تعديل سبب إلغاء»).
- Search «ابحث في أسباب إلغاء...». Columns #/الاسم/الحالة/الإجراءات.
- Editor: «الاسم» (e.g. «مثال: العميل ألغى بنفسه») + «نشط». Submit → `POST`/`PATCH /sales/cancel-reasons` («تمت إضافة سبب إلغاء بنجاح.»/«تم تحديث سبب إلغاء بنجاح.»). Delete → confirm → `DELETE /sales/cancel-reasons/:id`. Helper: «يظهر هذا السبب في نافذة إلغاء الطلب داخل تأكيد الطلبات وسجل الطلبات.»

### 10. FulfillmentBatches — `/dashboard/fulfillment-lists?tab=picking|packing`; legacy `/dashboard/picking-list` → `?tab=picking` («سلال السحب») and `/dashboard/packing-list` → `?tab=packing` («صناديق التغليف»)
Purpose: picking vs packing batch queues. Type mapping: picking→`PICKING`, packing→`PACKING`. Lifecycle (backend, irreversible): NEW→DONE/CANCELLED — «جديدة»/«مكتملة»/«ملغاة».
- `GET /sales/fulfillment-batches?type&status?&search?&page&pageSize=10` + `GET /inventory/warehouses`. Count «… دفعة». «تحديث» → reload. «دفعة جديدة» → editor (warehouse select «المستودع»/«— اختر المستودع —», required «يرجى اختيار المستودع.»). Submit → `POST /sales/fulfillment-batches` (name auto-stamped «تجهيز/تغليف <date> <time>») → «تم إنشاء الدفعة بنجاح.».
- Filter: search «ابحث برقم الدفعة...» + status select («الكل»/جديدة/مكتملة/ملغاة). Pagination «السابق»/«التالي» («صفحة … من …»).
- Per-row status `<select>` → `POST /sales/fulfillment-batches/:id/complete` or `POST /:id/cancel` → «تم تحديث حالة الدفعة.». Backend: `ViewFulfillment` (list) / `ManageFulfillment` (write).

### 11. ShippingReturns — canonical `/dashboard/returns?tab=shipments`; legacy `/dashboard/shipping-returns` redirects (`pages/ShippingReturns/ShippingReturns.tsx`)
Purpose: record carrier-brought returns and mark money collected. A return is a record, not a workflow — only transition is collect.
- `GET /sales/shipping-returns?search?&pageSize=200`; «تحصيل» filter («كل الحالات»/«غير محصّل»/«محصّل») client-side. Search «ابحث عن مرتجع...». «تحديث» → reload. «مرتجع جديد» → inline form: «رقم الطلب»، «السليم»/«التالف»/«المفقود»/«المبلغ»/«سعر الشحن» → `POST /sales/shipping-returns` («تعذر إضافة المرتجع.» on error).
- Barcode receive: «استلام بالباركود — امسح أو أدخل كود المرتجع ثم Enter» + «استلام» → `GET /sales/shipping-returns?search=code&pageSize=5`, exact `referenceNumber` preferred; match card (ref/carrier/counts/total) with «طباعة الإيصال» (popup Arabic receipt → `window.print`)، «تحصيل» (→ `POST /sales/shipping-returns/:id/collect`)، «إخفاء»; miss → «لا يوجد مرتجع مطابق للكود …».
- Table: #/المرتجع (ref + notes + date)/الطلب/العميل/شركة الشحن/السليم/التالف/المفقود/المبلغ بدون الشحن/سعر الشحن/المبلغ بالشحن/الحالة («محصّل (date)»/«غير محصّل»)/تحصيل («تحصيل» → collect)/طباعة («طباعة» → receipt popup). Backend: `ViewShippingReturns` / `ManageShippingReturns`.

### 12. ReturnRequests — `/dashboard/returns?tab=requests` («طلبات الإرجاع», `pages/ReturnRequests/ReturnRequests.tsx`)
Purpose: RETURN-type orders putting goods back to warehouses. Header «طلبات الاسترجاع».
- `GET /sales/orders?type=RETURN&pageSize=200` + `GET /inventory/warehouses` + `GET /catalog/products?isActive&pageSize=200`.
- «+ استرجاع جديد» → form: «رقم الطلب الأصلي المرتبط (إن وجد)» (resolved via `GET /sales/orders?search=<num>&pageSize=1`, ignored with warning «الطلب الأصلي المشار إليه غير موجود، سيتم تجاهل الربط.» if missing)، «اسم العميل *»، «رقم هاتف العميل *»، «مستودع إرجاع السلع»، «خصم إضافي (%)»، «ملاحظات الاسترجاع والعيوب»، items «الأصناف المرتجعة *» with «+ إضافة منتج» / per-row «المنتج»/«الكمية المرتجعة»/«سعر الوحدة» (disabled)/«حذف». Submit «تسجيل الاسترجاع» → `POST /sales/customers/find-or-create` then `POST /sales/orders` (`type:'RETURN'`, `shippingCost:0`) → «تم تسجيل طلب استرجاع جديد بنجاح.» + reload. «إلغاء» closes.
- Table «سجل طلبات الاسترجاع»: رقم السند/العميل/الهاتف/المخزن/الصافي المالي/شركة الشحن/المدينة/التاريخ/الحالة (+ «⚠️ عجز مخزون»)/«حذف» → confirm → `DELETE /sales/orders/:id`. (Sibling tab `exchanges` → `ExchangeRequests`, same pattern with `type:'EXCHANGE'`.)

### 13. ConfirmationOverview — `/dashboard/confirmation-overview` (`pages/ConfirmationOverview/ConfirmationOverview.tsx`)
Purpose: confirmation call queue — stats, per-product confirmation rates, actionable NEW/NO_ANSWER/POSTPONED rows. Header «تاكيد الطلبات».
- `GET /reports/orders/confirmed` (cards: «طلبات معلقة بانتظار التأكيد»، «قيمة الطلبات المعلقة» ج.م، «طلبات اليوم الجديدة» %، «بانتظار الاتصال») + `GET /reports/orders/product-confirmation` («نسب تأكيد المنتجات»: المنتج/الكود/إجمالي الطلبات/المؤكدة/نسبة التأكيد) + `GET /sales/orders?page&pageSize=10&search?&status?` («طابور المراجعة والاتصال بالعملاء»).
- Filters: «بحث برقم الطلب أو اسم العميل أو الهاتف...» + select («كل الحالات»/«جديد»/«لم يرد»/«مؤجل»). Pagination «السابق»/«التالي» («الصفحة … من … (… طلب)»).
- Row click expands → lazy `GET /sales/orders/:id` (items incl. «الكمية المؤكدة»، «يحتاج تصنيع»/«متوفر»). Badge «⚠️ عجز مخزون» when `hasShortage`.
- Per-row actions: «تأكيد الطلب» → `POST /sales/orders/:id/status {status:CONFIRMED}`; «تأجيل» → `{status:POSTPONED}`; «لم يرد» → `{status:NO_ANSWER}`; «إلغاء» → modal «إلغاء الطلب …» («يرجى اختيار سبب الإلغاء:» + Select «اختر سبب الإلغاء» from `GET /sales/cancel-reasons`, «تراجع» dismisses, «تأكيد الإلغاء» → `POST …/status {status:CANCELLED, cancelReasonId}`; empty → «يرجى اختيار سبب الإلغاء.»). All mutate → «تم تحديث حالة الطلب بنجاح.» + reload.

## Catalog

Catalog = what the company sells and how it is grouped. Frontend: `pages/*`, `routes/_app/dashboard/*`, `lib/api/catalog.ts`. Backend: `api/src/modules/catalog/*` (`catalog.routes.ts` mounts `brands`, `categories`, `uoms`, `tax-rates`, `attributes`, `attributes/:attributeId/values`, `products`, `products/:productId/images`, `merges`; resource routes `GET /`, `GET /:id`, `POST /`, `PATCH /:id`, `DELETE /:id` via `defineResource`).

| Page | URL path | Route file | Notes |
|---|---|---|---|
| ProductsManagement | `/dashboard/products` | `routes/_app/dashboard/products.tsx` → `asRoute(ProductsManagement)` | Direct route |
| AddProduct | `/dashboard/add-product` | `routes/_app/dashboard/add-product.tsx` | Direct route; doubles as edit screen when `sessionStorage.editingProductId` is set (nothing in the catalog currently sets it — dead entry path) |
| ProductFamily | `/dashboard/product-family` | `routes/_app/dashboard/product-family.tsx` | Direct route; 4 internal tabs, no query param |
| ProductStocks | `/dashboard/product-stocks` | `routes/_app/dashboard/product-stocks.tsx` | Direct route, read-only report |
| BrandsManagement | `/dashboard/directory?tab=brands` (canonical). Old `/dashboard/brands` redirects | `routes/_app/dashboard/directory.tsx` (`TABS.brands`), `routes/_app/dashboard/brands.tsx` (redirect) | Sidebar «البيانات الأساسية» → «البيانات المرجعية». Tabs: «الماركات»، «الأقسام»، «وحدات القياس»، «الأسباب»، «المحافظات»، «المدن» |
| CategoriesManagement | `/dashboard/directory?tab=categories` (old `/dashboard/categories` redirects) | `routes/_app/dashboard/directory.tsx` | Same merged screen |
| UomManagement | `/dashboard/directory?tab=uom` (old `/dashboard/uom` redirects) | `routes/_app/dashboard/directory.tsx` | Same merged screen |
| Tax rates | No dedicated page. Only «ضريبة المبيعات» / «ضريبة المشتريات» dropdowns inside AddProduct step 2 | — | Backend CRUD exists (`/catalog/tax-rates`), FE uses only `listTaxRates` |
| Attributes / values / merges | No separate routes. Tabs inside ProductFamily: «الخصائص»، «قيم الخصائص»، «المتغيرات»، «الدمج» | — | — |

Global permission plumbing: `useCurrentUser()` resolves `hasPermission(name)` from `GET /auth/me` (5-min stale). 403s → global «صلاحية مرفوضة» modal + «حسناً، فهمت»; 401 → `mawzun:session-expired` → `/login`.

### 1. ProductsManagement — `/dashboard/products` (`pages/ProductsManagement/ProductsManagement.tsx`, ~1399 lines)
Purpose: paginated product directory — search, filter, inspect, quick-edit, barcode-print, bulk archive, delete, store-export stub.
- Permissions (frontend): `hasUpdate = hasPermission("Permissions.UpdateProduct")`, `hasDelete = hasPermission("Permissions.DeleteProduct")`. Backend: list/get need `ViewProducts`; patch/archive/unarchive need `UpdateProduct`; delete (soft) needs `DeleteProduct`.
- Header «إدارة المنتجات» / «دليل المنتجات — عرض وتصفية وبحث في جميع المنتجات المسجلة على النظام.» + counter «N منتج» + «تحديث» → `load()` → `GET /catalog/products` + `GET /catalog/categories` + `GET /catalog/brands`.
- Search «ابحث باسم المنتج، كود SKU، الباركود...» → `GET /catalog/products?search=…`. «كل الأقسام» → `?categoryId=…`. «كل الماركات» → `?brandId=…`. Status «الكل»/«نشط»/«غير نشط» → `?isActive=…`. Note: API also supports `archived=` but the page exposes no archived filter — archived products are silently hidden.
- `DataGridToolbar` (column visibility: «الصورة»، «رمز SKU»، «الباركود»، «الاسم»، «القسم»، «الماركة»، «سعر البيع»، «سعر قبل الخصم»، «التكلفة»، «تاريخ الإضافة»، «الرصيد المتاح»، «الحالة») + «🏪 تصدير الى المتجر» → `openStoreModal()` → `GET /system/stores?pageSize=100` → store modal.
- Row checkbox + header «تحديد الكل» (local selection). `GridBulkBar`: «أرشفة»/«إلغاء الأرشفة» (`disabled={saving || !hasUpdate}`) → confirm with count → per item `POST /catalog/products/:id/archive` or `/unarchive` → «تم أرشفة/إلغاء أرشفة N منتج بنجاح.».
- Row «تفاصيل» → expands inline; first open `GET /catalog/products/:id` (cached): «الوصف:»، «المخزون حسب الموقع» («المستودع»، «الموقع»، «المتاح»، «محجوز»; empty «لا توجد مستويات مخزون مسجلة.»), «الإصدارات (N)» («الاسم»، «SKU»، «السعر»، «الخصائص»، «الحالة»; empty «لا توجد إصدارات.»).
- Row print-barcode icon (`title "طباعة باركود"`) → `printBarcode(product)` → `window.open` popup with JsBarcode CODE128 (`barcode || skuCode`), auto-print; blocked → alert about popups.
- Row edit (gated `hasUpdate`) → «تعديل المنتج — X» modal (prefill + `GET /catalog/products/:id` for description/weight/trackExpiry/gallery): «اسم المنتج *»، SKU، «الباركود»، «سعر التكلفة *»، «سعر البيع *»، «السعر قبل الخصم»، «الوزن (كجم)»، «تتبع الصلاحية»، «القسم» («غير محدد» + categories)، «الماركة»، «الوصف»، «روابط صور المنتج» (see image flow)، «نشط (متاح للشراء والمبيعات)» → «حفظ التعديل» → validates («يرجى إدخال الحقول المطلوبة: الاسم، كود SKU، السعر، وسعر التكلفة.») → `PATCH /catalog/products/:id` → «تم تعديل المنتج بنجاح.».
- Image upload flow (edit modal): «روابط صور المنتج» + URL input (`placeholder "https://example.com/image.jpg"`) + «إضافة رابط» + «رفع ملفات» (hidden multi-file `accept image/jpeg,png,webp,gif,avif`; «جاري الرفع...») → per file `POST /catalog/products/:id/images/upload` multipart `file` → URLs appended + «تم رفع الصور بنجاح.»; per-thumb ✕ removes locally; hint «الصق رابط صورة لإضافتها — الحفظ يستبدل معرض الصور بالقائمة المعروضة.» (save sends full `images[]` with `isPrimary: index===0`).
- Store modal «تصدير المنتجات الى المتجر»: per store row shows name + platform + disabled «دفع المنتجات (قريباً)»; footnote «📡 مزامنة المتاجر (Shopify / WooCommerce) غير مفعّلة حالياً»; «إغلاق» closes. No POST is ever fired.
- Row delete (gated `hasDelete`) → confirm naming the product → `DELETE /catalog/products/:id` (soft) → «تم حذف المنتج بنجاح.».
- Pagination «السابق»/«التالي» + «الصفحة N من M». Empty «لا توجد نتائج» / «لم يتم العثور على منتجات تطابق معايير البحث.». Loading «جاري التحميل...».

### 2. AddProduct — `/dashboard/add-product` (`pages/AddProduct/AddProduct.tsx`, ~1086 lines)
Purpose: 4-step wizard («المعلومات الأساسية» → «التصنيف والوصف» → «المخازن والأرفف» → «الوسائط والمراجعة») to create a product (or edit if `sessionStorage.editingProductId` set). Draft in `localStorage["formDraft_addProduct"]` (new only).
- Title «إضافة منتج» / «تعديل المنتج». Step circles clickable backwards only.
- Backend gates: `POST /catalog/products` (`CreateProduct`), `PATCH` (`UpdateProduct`), `POST /inventory/stock/adjust` (`ManageInventory`), reorder-points create/update, `POST …/images/upload` (`UpdateProduct`). Initial: `GET /catalog/categories?pageSize=200`, `GET /catalog/brands?pageSize=200`, `GET /catalog/tax-rates` (bare array), `GET /inventory/warehouses`, `GET /inventory/storage-locations`; edit adds `GET /catalog/products/:id` + `GET /inventory/reorder-points?productId=…`.
- Step 0 «المعلومات الأساسية»: «اسم المنتج *» (`"مثال: تيشرت قطني أسود"`)، «رمز SKU *» (`"مثال: TSH-BLK-M"`)، «الباركود (Barcode)»، «سعر التكلفة الأساسي *»، «سعر البيع *»، «السعر قبل الخصم (اختياري)»، «الوزن (كجم - اختياري)»، «تتبع تاريخ الصلاحية». «التالي» needs name+sku+price+cost.
- Step 1 «التصنيف والوصف»: «القسم» («بدون قسم»)، «الماركة / العلامة» («بدون ماركة»)، «ضريبة المبيعات» / «ضريبة المشتريات» («بدون ضريبة» + `${name} (${percentage}%)`)، «الوصف».
- Step 2 «المخازن والأرفف»: «الحدود التنبيهية للمخازن» + «+ إضافة حد مستودع» (per row «المخزن» + «الحد الأدنى» + «الحد الأقصى» + «حذف»). «أماكن التخزين» + «+ إضافة ربط رف» (per row «الرف / موقع التخزين» + «الكمية البدئية (تطبق فقط عند الإنشاء)» disabled when editing + «حذف»). Note: «الكميات الابتدائية تُسجّل عند الإنشاء فقط.»
- Step 3 «الوسائط والمراجعة»: «روابط صور المنتج» URL input + «إضافة رابط» + «رفع ملفات»/«جاري الرفع...» → if editing, per file `POST /catalog/products/:id/images/upload` + «تم رفع الصور بنجاح.»; if new, error «احفظ المنتج أولاً ثم ارفع الصور من شاشة التعديل.» (URLs only). Per-thumb ✕ «إزالة», «إزالة الكل». «نشط (متاح للشراء والمبيعات)». Review panels: «المعلومات الأساسية»، «التصنيف والوصف»، «المخازن والأرفف»، «الوسائط والحالة».
- Footer «السابق»; final «إضافة المنتج»/«حفظ التعديل» → validates → `POST /catalog/products` or `PATCH /catalog/products/:id` (incl. `salesTaxRateId`, `purchaseTaxRateId`, `images: [{imageUrl, isPrimary}]`); new only: per location qty>0 → `POST /inventory/stock/adjust` (`{countedQuantity, reason: "رصيد افتتاحي"}`); per warehouse row → `POST /inventory/reorder-points` or `PATCH /:id` → clears draft → `navigate("/dashboard/products")`. «إلغاء» clears + navigates to products.

### 3. ProductFamily — `/dashboard/product-family` (`pages/ProductFamily/ProductFamily.tsx`, ~475 lines)
Purpose: variation axes, values, read-only variant browser, product merges. Tabs (local): «الخصائص» / «قيم الخصائص» / «المتغيرات» / «الدمج». Footer marker «نموذج تطابق API الملتقط» (debug caption). No FE permission gates on tabs; backend: attributes/values read `ViewProducts`, write `CreateProduct`+`UpdateProduct`; merges list `ViewProducts`, write `UpdateProduct`.
- Tab «الخصائص»: count «خاصية», «تحديث» → `GET /catalog/attributes`; «إضافة خاصية»; search «ابحث بالاسم أو الرمز...» (client). Form «الخاصية»: «اسم الخاصية» (`#attribute-name`, required)، «الرمز» (required)، «النوع» («نص» TEXT / «قائمة» SELECT / «لون» COLOR)، «نشط» → `POST /catalog/attributes` or `PATCH /:id` → «تم إضافة/تحديث الخاصية.». Table («الاسم»، «الرمز»، «النوع»، «القيم»، «الحالة»): edit / delete (`DELETE /catalog/attributes/:id`, cascades values → «تم حذف الخاصية.»; no confirm on this tab).
- Tab «قيم الخصائص»: «تحديث» → `GET /catalog/attributes` + fan-out `GET /catalog/attributes/:id/values`; «إضافة قيمة». Search «ابحث بالقيمة أو الخاصية...». Form: «الخاصية» (required «يجب اختيار الخاصية.»)، «القيمة»، «لاحقة SKU»، «الباركود»، «ترتيب العرض» → `POST /catalog/attributes/:attributeId/values` or `PATCH /…/values/:valueId` → «تم إضافة/تحديث القيمة.». Table («الخاصية»، «القيمة»، «لاحقة SKU»، «الباركود»، «الحالة»): edit/delete.
- Tab «المتغيرات» (read-only): `GET /catalog/products?pageSize=100` + N× `GET /catalog/products/:id`. Count «متغير». Search «ابحث بالاسم أو SKU أو الباركود...». «إضافة متغير» → info «تُدار المتغيرات من صفحة تعديل المنتج نفسها.» (no standalone endpoints; wholesale replace via product update). Table («المتغير»، «المنتج»، «SKU»، «السعر»، «التكلفة»، «الحالة»، «الباركود»): barcode button → popup + JsBarcode, auto-print.
- Tab «الدمج»: `GET /catalog/merges?pageSize=100` + `GET /catalog/products?pageSize=100`. Count «عملية دمج». Search «ابحث بالمنتجات أو السبب...». «إضافة دمج»: «المنتج المصدر»، «المنتج الهدف»، «السبب» → requires both («يجب اختيار المنتجين.») → `POST /catalog/merges` (PENDING) → «تم إنشاء الدمج.» (never edited). Table («المنتج المصدر»، «المنتج الهدف»، «السبب»، «الحالة» («معلق»/«ملغي»/«تم الدمج»)، «تاريخ الإنشاء»، «تاريخ التنفيذ»): PENDING rows ✓ (`تنفيذ الدمج`) → confirm («سيتم نقل بيانات «S» إلى «T» وأرشفة المنتج المصدر.») → `POST /catalog/merges/:id/execute` (backend moves stock/order lines, archives source) → «تم تنفيذ الدمج بنجاح.»; ✕ → `POST /:id/cancel` → «تم إلغاء الدمج.».
- Data-model note: backend writes executed status as `MERGED`, FE guards use `EXECUTED` — executed merges fall through to «معلق» label and keep showing execute/cancel; re-executing returns backend not-pending error.

### 4. ProductStocks — `/dashboard/product-stocks` (`pages/ProductStocks/ProductStocks.tsx`, ~102 lines)
Purpose: read-only stock-by-bin report with cost totals. No FE gates. Backend `GET /reports/stock` (+ totals) need `ViewReports` + `ViewInventory`.
- Header «المخازن» / «أرصدة المنتجات» / «الكميات والتكاليف لكل منتج في كل موقع تخزين.» Chips: «N سجل»، «إجمالي الكمية N»، «المحجوز N»، «المتاح N»، «إجمالي التكلفة N ج.م» + «تحديث» → parallel `GET /reports/stock?search=&page=&pageSize=20` + totals.
- Search «ابحث باسم المنتج أو الكود...» (350 ms debounce). Table («المنتج»، «التصنيف»، «الموقع»، «المخزن»، «الكمية»، «تكلفة الوحدة»، «إجمالي التكلفة»; money `ar-EG`). Pagination «السابق»/«التالي». No navigation, no mutations.

### 5. BrandsManagement — `/dashboard/directory?tab=brands` (`pages/BrandsManagement/BrandsManagement.tsx`, ~275 lines)
Purpose: brand reference list for product cards. `embedded` prop only switches wrapper. Gates `CreateBrand`/`UpdateBrand`/`DeleteBrand` (FE mirrors). Backend (`brands.ts`): view `ViewBrands|ViewProducts`; manage per-permission; soft delete; name-unique («يوجد ماركة بنفس الاسم بالفعل.»); slug auto-regenerated.
- Heading «بيانات مرجعية» / «إدارة الماركات (Brands)» / «أضف الماركات والعلامات التجارية التي تنتمي إليها المنتجات في النظام.» Actions: «N ماركات», «تحديث» (`GET /catalog/brands?pageSize=200`), «إضافة ماركة» (gated).
- Notices «تمت إضافة/تحديث/حذف الماركة بنجاح.»; validation «يرجى إدخال اسم الماركة.». Search «ابحث باسم الماركة أو الوصف...» (client) + «آخر تحديث HH:MM».
- Form («إضافة ماركة»/«تعديل الماركة»): «اسم الماركة» (`"مثال: آبل، سامسونج"`, autofocus)، «الوصف»، «رابط الشعار (Logo URL)» + «رفع ملف»/«جاري الرفع...» (`POST /system/uploads` via `useFilePicker`; `RemoteImage` preview)، «نشطة (متاحة للاستخدام في كرت المنتج)» → `POST /catalog/brands` or `PATCH /:id`; «إلغاء» closes. Empty «لا توجد ماركة مضافة بعد» / «لا توجد نتائج مطابقة».
- Table («الشعار» (fallback «M»)، «الاسم»، «الوصف»، «الرابط (Slug)»، «المنتجات» (`_count.products`)، «الحالة»): edit/delete gated (`confirm("هل أنت متأكد من حذف الماركة «X»؟")`). No navigation.

### 6. CategoriesManagement — `/dashboard/directory?tab=categories` (`pages/CategoriesManagement/CategoriesManagement.tsx`, ~282 lines)
Purpose: hierarchical product taxonomy (tree with cycle guard). Gates mirror Brands. Backend: view `ViewCategories|ViewProducts`; manage per-permission; name-unique; self-parent refused («لا يمكن أن يكون التصنيف أباً لنفسه.») and descendant-move refused («لا يمكن نقل التصنيف إلى أحد فروعه.»); delete with children («لا يمكن حذف تصنيف يحتوي على تصنيفات فرعية.») or products («لا يمكن حذف تصنيف مرتبط بمنتجات.») refused — `remove()` confirm («هل أنت متأكد من حذف القسم «X» وكل ما يتعلق به؟») overstates; backend refuses instead.
- Heading «بيانات مرجعية» / «شجرة الأقسام (Categories)» / «إدارة الأقسام وتصنيفاتها الشجرية للمنتجات بشكل هرمي متداخل.» Actions «N أقسام», «تحديث», «إضافة قسم» (gated).
- Search «ابحث باسم القسم أو الوصف...» filters flattened tree; rows indent by level (`└── `); «القسم الرئيسي» shows parent badge or «قسم رئيسي».
- Form: «اسم القسم» (`"مثال: ملابس، أجهزة منزلية"`)، «القسم الرئيسي (أعلى شجرة)» («لا يوجد (قسم رئيسي)»; excludes self + descendants)، «الوصف»، «رابط الصورة (Image URL)» + «رفع ملف»/«جاري الرفع...»، «الترتيب» (0–9999, default 0)، «نشط» → `POST /catalog/categories` / `PATCH /:id`; «إلغاء» closes.
- Table («الصورة» (fallback «C»)، «الاسم»، «القسم الرئيسي»، «الوصف»، «الرابط (Slug)»، «الترتيب»، «المنتجات»، «الفروع»، «الحالة»): edit/delete gated. Empty «لا توجد قسم مضافة بعد» / «لا توجد نتائج مطابقة». No navigation.

### 7. UomManagement — `/dashboard/directory?tab=uom` (`pages/UomManagement/UomManagement.tsx`, ~116 lines)
Purpose: units of measure for products/purchasing. No FE gates. Backend (`uoms.ts`, bare array): view `ViewUoms|ViewProducts` (`GET /catalog/uoms?search=`); manage single `ManageUoms`; code uppercased, unique («يوجد وحدة قياس بنفس الكود بالفعل.»); no `deletedAt` — delete of a used unit refused («لا يمكن حذف الوحدة لأنها مستخدمة في منتجات. يمكنك تعطيلها بدلاً من ذلك.»), otherwise hard-deleted.
- Heading «المنتجات» / «فئات وحدات القياس» / «إدارة وحدات القياس المستخدمة في المنتجات والمشتريات.» Actions «N وحدة», «وحدة جديدة», «تحديث» (`GET /catalog/uoms?search=`).
- Form (grid): «الاسم» (required)، «الرمز» (required)، «الفئة» (default `"general"`)، «نشطة» → «حفظ»/«جاري الحفظ...» → `POST /catalog/uoms` or `PATCH /:id`; errors «تعذر تحميل وحدات القياس.» / «تعذر الحفظ.» / «تعذر الحذف.».
- Search «ابحث باسم أو رمز الوحدة...» (server-side on code+name). Table («الاسم»، «الرمز»، «الفئة»، «الحالة»): edit / delete (`confirm "تأكيد حذف X؟"`). No navigation.

### Cross-cutting notes
- Archive/unarchive/delete: delete = soft `DELETE /catalog/products/:id` (`DeleteProduct`; per-row «حذف» with confirm). Archive = `POST …/:id/archive` / unarchive (need `UpdateProduct`; bulk-only over grid selection). Merge execute archives source (`isActive=false, archivedAt=now`). No single-row archive button; no UI for the `archived=` list filter.
- Image uploads: (a) product images → `POST /catalog/products/:productId/images/upload` (multipart `file` + `altText`/`isPrimary`, R2) — edit modal + AddProduct edit mode; new-product wizard blocks upload («احفظ المنتج أولاً ثم ارفع الصور من شاشة التعديل.») and sends whole gallery on save (`{images: [{imageUrl, isPrimary}]}`). (b) reference images (brand logo, category image) → `POST /system/uploads` via `useFilePicker`, filling the same pasteable URL field.
- Links: catalog pages never `navigate()` except AddProduct (→ `/dashboard/products`). Edit/store flows are modals; directory tabs via `?tab=`; old `/dashboard/brands|categories|uom` redirect to tabs. Sidebar: «المخزون» → «المنتجات»، «إضافة منتج»، «الخصائص والمتغيرات»، «أرصدة المنتجات»; «البيانات الأساسية» → «البيانات المرجعية».
- Tax rates: FE read-only (`GET /catalog/tax-rates` → AddProduct dropdowns, preselected on edit). Backend full CRUD (view `ViewProducts`, manage `UpdateProduct|ManageSettings`, single-default invariant) but no FE writer.
- Variants: no standalone endpoints; read-only aggregation; writes only through product payloads.

## Inventory A — movements, operations, sales ledger

Route files are thin wrappers (`createFileRoute(…){ component: asRoute(Page) }`) — no `beforeLoad`, no per-route permission checks. Gating is in-page plus backend `requirePermission`. Sidebar labels from `navConfig.tsx`.

### 1. InventoryOverview — `/dashboard/inventory-overview` (`pages/InventoryOverview/InventoryOverview.tsx`) — «ملخص المخازن»
Purpose: read-only KPI dashboard of warehouse and product stats.
- «تحديث البيانات» → `loadData()` → parallel `GET /reports/overview/inventory` (إجمالي قيمة المخزون `ج.م`, عدد القطع المتاحة, عدد القطع الكلي, الكميات المحجوزة, حركات الإدخال, حركات الإخراج) + `GET /reports/overview/products` (إجمالي المنتجات, منتجات نشطة, منتجات نفذت (red), منتجات أوشكت على النفاد (amber)); skeleton grid while loading. No inputs, tabs, modals, filters. No navigation. No in-page gates.

### 2. InventoryAdjustment — `/dashboard/inventory-adjustment` (`pages/InventoryAdjustment/InventoryAdjustment.tsx`) — «الجرد الفعلي»
Purpose: physical count sheet — enter counted quantities per location, post differences as adjustments.
- «كل أماكن التخزين» select → client filter by `locationId`. «ابحث عن منتج...» → client name filter. «تحديث» → `load()` (`GET /inventory/storage-locations` + `GET /reports/stock?page=1&pageSize=200`).
- «الكمية الحقيقية» number input per row → `row.counted`; «الفارق بينهم» computes `counted − quantityOnHand` live (green `+` / red `−` / `—`).
- «حفظ التسويات» (disabled unless ≥1 differing row; «جاري الحفظ...», «N تسوية جاهزة للسجل») → `confirm("سيتم تسجيل N تسوية جرد…")` → one `POST /inventory/stock/adjust` per row (`{countedQuantity, reason:'تسوية جرد'}`, backend `ManageInventory`) → notice + `load()`. No navigation. No in-page gate (backend `ManageInventory`).

### 3. NewInventoryTransaction — `/dashboard/add-inventory-transaction` (`pages/NewInventoryTransaction/NewInventoryTransaction.tsx`) — «تسجيل حركة»
Purpose: single form for IN / OUT / TRANSFER / ADJUSTMENT movements.
- «المنتج *» (Select `name (skuCode)`), «نوع الحركة *» («وارد (زيادة رصيد)» IN / «صادر (سحب رصيد)» OUT / «تحويل مخزني» TRANSFER / «تسوية جردية» ADJUSTMENT; TRANSFER swaps in «موقع الوجهة *» instead of «رقم المرجع / الفاتورة»), «موقع التخزين *» / «موقع المصدر *» (`name (warehouse.name)`), «موقع الوجهة *», «رقم المرجع / الفاتورة» (`"مثال: Inv-10029"` — collected but **never sent**), «الكمية *», «السبب / الملاحظة».
- «إعادة تعيين» → `resetForm()`. «تسجيل الحركة» (disabled while saving or without `ManageInventory`) → validates («يرجى إدخال الحقول الأساسية…»); TRANSFER needs distinct destination («يرجى اختيار موقع وجهة مختلف…») → `POST /inventory/stock/transfer` → «تمت عملية التحويل المخزني بنجاح.»; else reads balance via `GET /inventory/stock/levels` then `POST /inventory/stock/adjust` → «تم تسجيل الحركة وتحديث رصيد المخزن بنجاح.». Init: `GET /inventory/storage-locations` + `listProducts({pageSize:200})`. No navigation. Gate: `ManageInventory` disables submit.

### 4. InventoryTransactions — `/dashboard/inventory-transactions` (`pages/InventoryTransactions/InventoryTransactions.tsx`) — «حركات التخزين»
Purpose: read-only paginated ledger of every stock movement.
- «ابحث باسم المنتج، المرجع، أو السبب...» → server `search`, page 1. Type select (وارد/صادر/تحويل/تسوية جردية) → **client-side only**. «كل المنتجات» → server `productId`; «كل المواقع» → server `storageLocationId`. «تحديث» (+ «N حركة») → `GET /inventory/stock/transactions` (backend `ViewInventory`). «السابق»/«التالي» («الصفحة N من M», pageSize 20).
- Columns: `#`، التاريخ والوقت, المنتج, موقع التخزين, نوع الحركة («وارد - إضافة»/«صادر - خصم»/«تحويل»/«تسوية جردية»), الكمية, الرصيد بعد, تكلفة الوحدة, رقم المرجع, الملاحظة, بواسطة (actor or «مسؤول»). Empty «لا توجد حركات مخزنية». No navigation. No in-page gate.

### 5. InventoryTransfers — `/dashboard/inventory-transfers` (`pages/InventoryTransfers/InventoryTransfers.tsx`) — «تحويلات المخزون»
Purpose: create warehouse-to-warehouse transfer operations and execute them.
- «تحديث» → `GET /inventory/operations` (`operationTypeId` = transfer type, pageSize 50). «إضافة تحويل» → inline form («من مستودع», «الى مستودع», «المرجع» default «تحويل مخزني», «ملاحظات»).
- «إنشاء التحويل» («جاري الإنشاء...») → validates («اختر نوع التحويل والمستودعين.» / distinct «مستودع المصدر والوجهة يجب أن يختلفا.») → `POST /inventory/operations` (`{operationTypeId, fromWarehouseId, toWarehouseId, reference, notes, items:[]}`) → «تم إنشاء التحويل. أضف الأصناف من شاشة حركات المخزون ثم نفّذه.». Transfer type auto-detected by code containing `TRANS` (`GET /inventory/operation-types`, `GET /inventory/warehouses`).
- «تنفيذ» per row (not DONE/CANCELLED) → confirm («تنفيذ التحويل وخصم الكميات من المصدر وإضافتها للوجهة؟») → `POST /inventory/operations/:id/execute` → «تم تنفيذ التحويل بنجاح.». Statuses: جديدة/قيد التنفيذ/جاهزة/منفذة/ملغاة. No navigation. Backend `ViewStockOperations` / `ManageStockOperations`.

### 6. OperationsManagement — `/dashboard/stock-operations` + `/dashboard/operation-types` (`pages/OperationsManagement/OperationsManagement.tsx`, 684 lines; one component, initial tab by URL)
Purpose: (a) «الحركات» — full lifecycle of planned stock operations; (b) «الأنواع» — CRUD for operation types.
- Tab bar «الحركات» / «الأنواع» → `setTab` + `navigate(...)` — the only cross-navigation here.
- «الحركات»: counter «N حركة» + «تحديث» (operations pageSize 100, types, products pageSize 200). «ابحث برقم العملية أو المرجع...» (client) + «كل الأنواع» select (client). «حركة جديدة» (gated `ManageStockOperations`) → form («المنتج», «الكمية», «تكلفة الوحدة», «المرجع») → `POST /inventory/operations` (`{operationTypeId: types[0].id, reference, items}`) → «تم إنشاء الحركة كمعلقة.». Row link-button («عرض التفاصيل») expands detail (from/to warehouse, نفذها, تاريخ التنفيذ, ملاحظات + lines: الصنف/المتغير/المخطط/المنفذ/المتبقي/التكلفة). «تنفيذ»/«إلغاء» per PENDING row (gated) → `POST /:id/execute` / `/:id/cancel`. Chips: مسودة/معلق/جاهزة/مكتملة/ملغاة.
- «الأنواع»: counter + «تحديث» + «نوع جديد» → editor («الاسم», «الكود» auto-uppercase, «بادئة الترقيم» default `OP`, «طريقة الحجز» يدوي MANUAL / الأقدم أولاً FIFO / الأحدث أولاً LIFO, «الوصف», «يتطلب تأكيدًا», «نشط») → `POST /inventory/operation-types` / `PATCH /:id` → «تم إضافة/تحديث نوع العملية.». Search «ابحث بالاسم أو الكود...» (client). Edit / delete (`confirm("حذف …؟")` → «تم حذف نوع العملية.»; backend refuses types used by operations: «لا يمكن حذف نوع حركة مستخدم في عمليات مخزون.»). Note: types tab gate is hardcoded empties so `canManage` is always false — «نوع جديد»/edit/delete never render (latent bug; backend still enforces).
- Backend: operations `ViewStockOperations` / `ManageStockOperations`; types via `defineResource` (view `[ViewStockOperations, ViewInventory]`, manage `[ManageStockOperations]`).

### 7. OrdersTransactions — `/dashboard/orders-transactions` (`pages/OrdersTransactions/OrdersTransactions.tsx`) — «حركات البيع»
Purpose: combined sales + returns ledger with collection totals and exportable grid.
- Summary strip: «عدد العمليات», «إجمالي المحصل … ج.م», «إجمالي الشحن … ج.م» (client sums). «تحديث» → `GET /sales/orders?type=SALE&pageSize=200` + `GET /sales/orders?type=RETURN&pageSize=200` (merged client-side).
- `DataGridToolbar` (`storageKey 'orders-transactions'`): search/filter/sort/group/export over رقم الطلب, التاريخ, العميل, طريقة الدفع, شركة الشحن, الشحن, الخصم %, الصافي المحصل, الحالة. Read-only; empty «لا توجد معاملات.», error «تعذر تحميل حركات البيع.». No navigation. No in-page gate.

Cross-navigation: none of the 7 link to each other except the OperationsManagement tab switch. Sidebar: «ملخص المخازن» (home), «حركات البيع» (sales), «حركات التخزين»/«تسجيل حركة»/«الجرد الفعلي»/«تحويلات المخزون» (inventory), «حركات المخزون» (purchasing). No route-level permission guards — backend `requirePermission` (`ViewInventory`/`ManageInventory`, `ViewStockOperations`/`ManageStockOperations`) plus the two in-page gates noted.

## Inventory B — stock, warehouses & scanning

### 1. StockCounts — `/dashboard/stock-counts` (`pages/StockCounts/StockCounts.tsx`) — «جرد المخزون»
Purpose: open a physical stock count, record counted quantities per line, approve variances into stock.
- «تحديث» → `GET /inventory/counts?pageSize=100` + `GET /inventory/warehouses`. «فتح جرد جديد» → create form: «المستودع (اختياري)» (on change loads `GET /inventory/storage-locations?warehouseId=…`), «مكان التخزين (اختياري)», «السبب» (`"مثال: جرد شهري"`), «ملاحظات». «فتح الجرد» («جارٍ الفتح...») → `POST /inventory/counts` → «تم فتح الجرد بنجاح.»; «إلغاء» closes.
- Reference-number link per row → expands → `GET /inventory/counts/:id` (cached). «بدء» (DRAFT) → `POST /:id/start` → «بدأ الجرد.»; «اعتماد» (IN_PROGRESS) → `POST /:id/complete` → «تم اعتماد الجرد.»; «إلغاء» (DRAFT/IN_PROGRESS) → `POST /:id/cancel` → «تم إلغاء الجرد.».
- Counted-quantity input per line (IN_PROGRESS) + «حفظ الكميات المعدودة» → `POST /:id/items {items:[{productId, storageLocationId, countedQuantity}]}` → «تم حفظ الكميات المعدودة.»; empty blocked («أدخل كمية معدودة لصنف واحد على الأقل.»).
- Badges: «مسودة»/«جارٍ الجرد»/«مكتمل»/«ملغي». Empty «لا توجد جردات بعد». Backend (`stockCounts.ts`, `/inventory/counts`): get needs `ViewInventory`; writes need `ManageInventory`. No navigation. No UI gate.

### 2. WarehousesManagement — `/dashboard/warehouses` (`pages/WarehousesManagement/WarehousesManagement.tsx`) — «المخازن» (also `embedded`-reusable)
Purpose: CRUD for physical warehouses linked to shipping orders and stock.
- «تحديث» → `GET /inventory/warehouses` (bare array; search/filter/paging client-side) + `GET /shipping/countries?isActive=true` (Arabic names; failure tolerated). «إضافة مخزن» (gated) → form. Search «ابحث بالاسم، الكود، العنوان، الهاتف...» + status «الكل»/«نشط»/«غير نشط». Pager «السابق»/«التالي» (20/page).
- Form: «اسم المخزن» (`"مثال: المخزن الرئيسي، مخزن أكتوبر"`), «كود المخزن (فريد)», «الدولة» (`nameAr (code)` select or free `"مثال: EG"` input), «رقم الهاتف», «العنوان التفصيلي», «ملاحظات», «نشط (متاح للربط بالطلبات والمخزون)». «إضافة السجل»/«حفظ التعديل» («جاري الحفظ...») → `POST /inventory/warehouses` or `PATCH /:id` → «تمت إضافة/تحديث المخزن بنجاح.»; validation «يرجى إدخال اسم المخزن وكود المخزن.»; «إلغاء» discards.
- Row edit («تعديل», gated) / delete («حذف», gated) → confirm («هل أنت متأكد من حذف المخزن «…»؟») → `DELETE /inventory/warehouses/:id` → «تم حذف المخزن بنجاح.» (backend refuses when locations/stock exist).
- Backend (`warehouses.ts` via `defineResource`, `/inventory/warehouses`): list/detail need `ViewWarehouses` or `ViewInventory`; writes need `CreateWarehouse`/`UpdateWarehouse`/`DeleteWarehouse`. Countries `GET /shipping/countries` (unguarded). No navigation. UI gates `CreateWarehouse`/`UpdateWarehouse`/`DeleteWarehouse`.

### 3. StorageLocations — `/dashboard/storage-locations` (`pages/StorageLocations/StorageLocations.tsx`) — «مواقع التخزين»
Purpose: CRUD for shelves/bins inside warehouses, optional parent hierarchy, weight/volume caps.
- «تحديث» → `GET /inventory/storage-locations` + `GET /inventory/warehouses`. «إضافة موقع» (gated). Search «ابحث باسم الموقع، الكود، أو المستودع...», warehouse «كل المستودعات», status «الكل»/«نشط»/«غير نشط». Pager 20/page.
- Form: «الاسم» (`"مثال: الرف A-1"`), «الكود (فريد)» (`"مثال: LOC-A1"`), «المستودع», «الموقع الأب (اختياري)» («لا يوجد (مستوى رئيسي)» — self/descendants excluded), «الوزن الأقصى (كجم)», «الحجم الأقصى (م٣)», «ملاحظات», «نشط (متاح للاستخدام الفوري)». «إضافة السجل»/«حفظ التعديل» → `POST`/`PATCH /inventory/storage-locations`; validation «يرجى إدخال الاسم، الكود، واختيار المستودع.»; «إلغاء» closes.
- Row edit/delete (gated) → confirm («هل أنت متأكد من حذف موقع التخزين «…»؟») → `DELETE /:id` → «تم حذف موقع التخزين بنجاح.».
- Backend (`storageLocations.ts`): list/detail need `ViewStorageLocations` or `ViewInventory`; writes need per-action permissions. No navigation. UI gates per-action.

### 4. LowStock — tab `low-stock` on `/dashboard/alerts?tab=low-stock` (label «تنبيهات النقص»); legacy `/dashboard/low-stock` redirects
Purpose: active products at/below a selectable threshold, for re-supply. Heading «المخزون المنخفض (Low Stock)».
- «تحديث» → `GET /catalog/products?pageSize=200&isActive=true`; chip «… منتج منخفض». Search «ابحث بالاسم أو الباركود أو SKU...» (client); «الحد الأدنى:» 3/5/10/20 (filters `available <= threshold`, ascending). Read-only table: المنتج / SKU / الباركود / الماركة / الفعلي / المحجوز / المتاح (red 0, amber otherwise) / السعر. Backend `GET /catalog/products` needs `ViewProducts`. No navigation. No UI gate.

### 5. DeficitsAlert — tab `deficits` on `/dashboard/alerts?tab=deficits` (label «عجز المخزون»); legacy `/dashboard/deficits-alert` redirects
Purpose: products below per-warehouse minimum (reorder points), grouped by product.
- «تحديث» → `GET /production/planning/deficits`; counter «… سجل في حالة عجز». Empty: «مستويات المخزون آمنة! / لا توجد أي أصناف حالياً تقل عن الحد الأدنى المحدد للمستودعات.».
- Product row click / ▼/▲ → per-warehouse sub-rows (warehouse, `min — max`, deficit or «مكتفي»). «جدولة تصنيع» per row → `navigate('/dashboard/production')`. Columns: المنتج / كود الصنف / الرصيد المتاح / الحد الأدنى المطلوب / العجز الصافي / الإجراء. Pager 10/page client-side.
- Backend (`production/planning.ts`, `/production/planning/deficits`): needs `ViewProductionBatches` + `ViewInventory`. No UI gate.

### 6. Scanning — `/dashboard/scanning` (`pages/Scanning/Scanning.tsx`) — «المسح الضوئي» (POS). Desktop/wide only (≥768px non-mobile UA); smaller screens get «شاشة المسح غير متوافقة / هذه الصفحة مخصصة للاستخدام على أجهزة الكمبيوتر المكتبية أو شاشات POS العريضة لتفعيل خاصية قارئ الباركود.»
Purpose: scan barcodes (keyboard-wedge, layout-independent incl. Arabic-keyboard mapping) into a list, post all lines as IN/OUT adjustments.
- Scanner input («بانتظار مسح الباركود...») — global `keydown` accumulates burst; Enter resolves barcode/SKU → adds/increments line; unknown → «المنتج غير موجود في النظام.». Init: `GET /catalog/products?pageSize=200` + `GET /inventory/storage-locations` («فشل تحميل المنتجات.»).
- «الرجوع للوحة التحكم» → `navigate("/dashboard")`. Gear («إعدادات ربط الأكواد») → modal «إعدادات ربط الأكواد الخارجية» («إغلاق» refocuses): «الكود الخارجي (الباركود الممسوح)» + «ابحث عن المنتج بنظام التشغيل...» picker (paged «السابق»/«التالي»), «حفظ الربط» (validations «يرجى إدخال الكود واختيار منتج.» / «هذا الكود الخارجي مرتبط بالفعل.» → «تم الربط بنجاح.»), «الأكواد المرتبطة حالياً» with per-row «حذف الربط» (local-only, no backend).
- Lines table «الأصناف الممسوحة» (empty «امسح باركود منتج للبدء.»): per-row «+» («إضافة»), «−» («إزالة 1»), «✕» («حذف المنتج»); pager. Summary «ملخص المسح» (الأصناف/القطع/المجموع الإجمالي «ج.م»).
- «موقع التخزين المستهدف» select + «إدخال الكل (وارد)» / «إخراج الكل (صادر)» → confirm modal «تأكيد عملية الدفعة» («إلغاء»/«تأكيد التنفيذ», «جاري التنفيذ...»). Confirm → `GET /inventory/stock/levels?storageLocationId=…&pageSize=200`, then per line `POST /inventory/stock/adjust` (`{countedQuantity: onHand±qty, reason: "إدخال/إخراج دفعة من جهاز المسح"}`) → «تم تنفيذ العملية على … صنف بنجاح.» (missing location: «يرجى اختيار موقع التخزين.»).
- Backend: `GET /catalog/products` (`ViewProducts`); locations view perms; `GET /inventory/stock/levels` (`ViewInventory`); `POST /inventory/stock/adjust` (`ManageInventory`). No UI gate.

### 7. ScannerTransactions — `/dashboard/scanner-transactions` (`pages/ScannerTransactions/ScannerTransactions.tsx`) — «سجل المسح»
Purpose: read-only window onto movement ledger rows produced by scanner runs.
- «تحديث» → `GET /inventory/stock/transactions?search=…&storageLocationId=…&page=…&pageSize=20`; counter «… حركة». No type dropdown by design (endpoint has none). Search «ابحث برقم المرجع أو السبب...» + location «كل المواقع» (`GET /inventory/storage-locations`); page 1 on change. Empty: «لا توجد حركات» / «لا توجد نتائج تطابق معايير البحث.» / «لم يتم تسجيل أي حركات مخزون بعد.».
- Table: المنتج / كود المنتج / نوع الحركة (badge وارد/صادر: «رصيد افتتاحي»، «شراء»، «بيع»، «مرتجع وارد»، «مرتجع صادر»، «تحويل وارد»، «تحويل صادر»، «تسوية بالزيادة»، «تسوية بالنقص»، «إنتاج وارد»، «إنتاج صادر»، «إعدام») / الكمية (±) / الرصيد بعد / موقع التخزين / المستخدم («النظام» fallback) / التاريخ والوقت. Pager.
- Row click or «التفاصيل» → local detail modal (no fetch — no single-transaction endpoint): product, type badge, qty, التاريخ والوقت / كود المنتج / موقع التخزين / المخزن / الرصيد بعد الحركة / تكلفة الوحدة / المستخدم المسؤول / رقم المرجع / سبب الحركة; «إغلاق» or overlay closes.
- Backend (`stock.ts`, `/inventory/stock/transactions`): needs `ViewInventory` (filters product/storageLocation/warehouse + search). No navigation. No UI gate.

### 8. ScannerTest — `/test` (route `_app/test.tsx` ← `pages/ScannerTest/ScannerTest.tsx`)
Dev-only HID barcode-scanner bench; production renders «هذه شاشة تجريبية للفريق التقني فقط.». No nav entry, no `DashboardLayout`.
- No buttons/inputs — document-level `keydown` listener: printable chars append to live box; Enter finalizes burst into `last scan: […] len=… avgGap=… minGap=… maxGap=… duration=…`; other keys logged `special key=…`; `Ctrl+Shift+R` resets. Labels: "Barcode Scanner Input Test", "Focus this page, then scan a barcode. Enter ends a burst. Ctrl+Shift+R to reset."
- Backend: none (fully local). No navigation. Gated by `import.meta.env.DEV` at route level only.

## Purchasing & production

API base `/api/v1` (`api/src/app.ts` → `createApiRouter()`; mounts `/purchasing`, `/production`, `/reports`, `/sales`, `/catalog`). Wrappers `lib/api/{purchasing,production,reports,sales,catalog}.ts`. No per-page `beforeLoad` — only global `_app` guard + `SessionGate`. Sidebar gating only: purchasing needs `Permissions.ViewVendors`.

### 1. PurchaseOrders — `/dashboard/purchase-orders` (`pages/PurchaseOrders/PurchaseOrders.tsx`, 707 lines) — «أوامر الشراء (Purchase Orders)»
Purpose: create and track supplier purchase orders and per-line receiving.
- Heading eyebrow «المشتريات», subtitle «إنشاء ومتابعة أوامر شراء المنتجات من الموردين وحالات الاستلام.» «أمر شراء جديد» → create form with one blank row. «تحديث» → `load()`.
- Search «ابحث برقم الأمر أو اسم المورد...» → server `search`. Status «الحالة:» («الكل»/«مسودة»/«تم الإرسال للمورد»/«استلام جزئي»/«تم الاستلام»/«ملغي») → `GET /purchasing/purchase-orders?search&status&page&pageSize=20`.
- Create form: «المورد» (from `GET /purchasing/vendors?pageSize=200`, «— اختر المورد —»)، «ملاحظات» («اختياري»); per-row «المنتج» («— اختر المنتج —», `GET /catalog/products?pageSize=200`)، «الكمية»، «سعر الوحدة»; «إضافة صنف» / trash «إزالة الصف»; live «الإجمالي:». Save → `POST /purchasing/purchase-orders {vendorId, notes, items}`; errors «يرجى اختيار المورد.», «أضف صنفاً واحداً على الأقل مع كمية صحيحة.»; success «تم إنشاء أمر الشراء بنجاح.».
- Table: order-number button («عرض الأصناف») → expands detail sub-table («الصنف»/SKU/«الكمية»/«المستلم»/«المتبقي»/«سعر الوحدة»/«الإجمالي») via `GET /purchasing/purchase-orders/:id` («جارٍ تحميل الأصناف...»); per-line «استلام» (remaining > 0, not CANCELLED) → `window.prompt("كمية الاستلام للصنف «…» (المتبقي …):")` → `POST /:id/receive {items}`; errors «تم استلام الكمية كاملة.»/«الكمية غير صالحة.»; success «تم تسجيل الاستلام بنجاح.». Per-row status `<select>` → `PATCH /:id {status}` → «تم تحديث حالة أمر الشراء.». Trash «حذف» → confirm («هل أنت متأكد من حذف أمر الشراء «…»؟») → `DELETE /:id` → «تم حذف أمر الشراء بنجاح.».
- Pager «السابق»/«التالي», «صفحة X من Y — Z أمر». No navigation. Backend gates: `ViewPurchaseOrders` (list/get), `CreatePurchaseOrder`, `UpdatePurchaseOrder` (status+receive), `DeletePurchaseOrder`.

### 2. PurchaseTransactions — `/dashboard/purchase-transactions` (`pages/PurchaseTransactions/PurchaseTransactions.tsx`, 110 lines) — «حركات الشراء»
Purpose: read-only aggregate of PO values and states, with export.
- Summary «إجمالي القيمة: X ج.م · Y أمر شراء» (client sum of `totalAmount`) + «تحديث» → `GET /purchasing/purchase-orders?page=1&pageSize=200`. Error «تعذر تحميل حركات الشراء.», loading «جاري التحميل...».
- `DataGridToolbar` (`storageKey: 'purchase-transactions'`, search/sort/group/export) over «رقم الأمر»/«التاريخ»/«المورد»/«الحالة»/«القيمة»; group headers «المجموعة: … (N)»; empty «لا توجد معاملات مشتريات.». No navigation. Gate: `ViewPurchaseOrders`.

### 3. VendorsManagement — `/dashboard/vendors` (`pages/VendorsManagement/VendorsManagement.tsx`, 181 lines) — «الموردون (Vendors)»
Purpose: CRUD on `SUPPLIER`-kind vendors. Subtitle «إدارة الموردين الذين تشتري منهم المنتجات لأوامر الشراء.»; chip «مورد»; «إضافة مورد»; refresh → `GET /purchasing/vendors?kind=SUPPLIER&pageSize=200` («تعذر تحميل الموردين.»).
- Search «ابحث بالاسم أو الهاتف أو البريد...» **client-side** (name/phone/email).
- Form: «اسم المورد» (required «يرجى إدخال اسم المورد.»), «رقم الهاتف»/«البريد الإلكتروني»/«العنوان»/«جهة الاتصال»/«الرقم الضريبي» (all «اختياري»), «العمولة %», «ملاحظات», «مورد نشط» → `POST /purchasing/vendors {kind:'SUPPLIER', …}` or `PATCH /:id` («تمت إضافة/تحديث المورد بنجاح.»).
- Table #/«الاسم» (+contact)/«الهاتف»/«البريد»/«العنوان»/tax/commission %/balance/PO count/`ActiveBadge` + edit (prefills incl. commission) / delete → confirm («هل أنت متأكد من حذف المورد «…»؟») → `DELETE /:id` → «تم حذف المورد بنجاح.». No navigation. Backend `defineResource` (view `[ViewVendors, ViewPurchaseOrders]`, manage `[CreateVendor, UpdateVendor, DeleteVendor]`).

### 4. ConsignmentVendors — `/dashboard/consignment-vendors` (`pages/ConsignmentVendors/ConsignmentVendors.tsx`, 130 lines) — «موردين الأمانة»
Purpose: CRUD on `CONSIGNMENT`-kind vendors (balance computed server-side, never typed). Chip «N مورد»; «مورد جديد» (PlusIcon); «تحديث» → `GET /purchasing/vendors?kind=CONSIGNMENT&pageSize=100` («تعذر تحميل موردي الأمانة.»).
- Form (grid): «الاسم» (required), «مسؤول التواصل», «رقم الهاتف», «البريد الإلكتروني», «العنوان», «الرقم الضريبي» (ltr), «ملاحظات», «نسبة العمولة %» (0–100), «نشط», «حفظ»/«جاري الحفظ...» → `POST` (kind CONSIGNMENT) or `PATCH /:id` («تعذر الحفظ.»).
- Search «ابحث باسم المورد...» is decorative — `query` never applied to rows (only `EmptyState hasSearch`); rows always show all items.
- Table #/«الاسم»/«مسؤول التواصل»/«الهاتف»/«البريد»/«العنوان»/«الرقم الضريبي»/«العمولة» (%)/«الرصيد»/«الحالة» («نشط»/«موقوف»)/«أوامر الشراء»/«إجراءات» → edit (prefills) / delete → `confirm('تأكيد حذف …؟')` → `DELETE /:id` («تعذر الحذف.»). No navigation. Same vendor gates.

### 5. SupplierOverview — `/dashboard/supplier-overview` (`pages/SupplierOverview/SupplierOverview.tsx`, 86 lines) — «موردين الأمانة» (title quirk)
Purpose: read-only vendor + purchases KPI dashboard (no inputs except refresh).
- Eyebrow «لوحة الإحصائيات», subtitle «ملخص أداء الموردين والمشتريات.»; «تحديث» → parallel `GET /purchasing/vendors?pageSize=200` + `GET /reports/overview/purchases` («تعذر تحميل ملخص الموردين.»).
- Tiles: «إجمالي الموردين», «أوامر شراء مُستلمة», «قيمة المشتريات المستلمة» (ج.م), «أوامر معلّقة», «قيمة المعلّقة», «أوامر ملغاة».
- «الموردون حسب الرصيد المستحق»: top-10 by `balance` desc (#/«المورد»/«أوامر الشراء»/«الرصيد»); empty «لا توجد بيانات بعد.» (no per-vendor purchase-total endpoint exists). No navigation. Gates: vendor view + `ViewReports, ViewPurchaseOrders` (`reports/overview.ts`).

### 6. Production — `/dashboard/production` (`pages/Production/Production.tsx`, 604 lines) — «إدارة الباتشات»
Purpose: schedule/track production batches from sale orders; no create form here (creation in AddBatch).
- Header «باتشات»/«إدارة الباتشات»/«خطط وجدولة باتشات التصنيع بناءً على الطلبات...»; «N باتشات»; «تحديث» → `GET /production/batches?page&pageSize=20&search&status` (+ refs products/orders; «حدث خطأ أثناء تحميل بيانات التصنيع.»).
- Search «البحث برقم الباتش أو الملاحظات...» (server), status «الكل»/«مخطط لها»/«قيد التشغيل»/«مكتملة»/«ملغاة» (server).
- Row click expands `ExpandedBatchDetail` → `GET /production/batches/:id`: «📦 إجمالي المواد المطلوبة للباتش (N أصناف):» («المستهدفة:»/«المنجزة:») + «📋 الطلبات المتضمنة:» (order no., «العميل: … (…)", status chip, «⚠️ عجز مخزون», «N أصناف»); empty «لا توجد طلبات مرتبطة بهذا الباتش.».
- Row quick actions: «مخطط» (quirk — matches no transition endpoint, only reloads + toast), «تشغيل» → `POST /:id/start`, «مكتمل» → `POST /:id/complete`, «ملغي» → confirm («هل أنت متأكد من إلغاء الباتش «…»؟») → `POST /:id/cancel`; «تعديل» → edit form; «حذف» → confirm → `DELETE /:id`. Toasts «تم تحديث حالة الباتش.»/«تم حذف الباتش بنجاح.».
- Edit form: «ملاحظات الباتش *» (required), «تاريخ البدء», «تاريخ الانتهاء» (quirk — collected but never sent; `UpdateBatch` has no such field), «حالة الباتش» (sent as `status` in `PATCH`), orders picker (search «بحث برقم الطلب أو اسم العميل...», filter «الكل»/«عجز مخزون»/«بدون عجز», checkboxes, pager ←/→), preview «📈 الكميات المجمعة للدفعة:», «إلغاء»/«حفظ الباتش» → `PATCH /production/batches/:id {notes, startDate, status, orderIds, items}`; validation «يجب اختيار طلب واحد على الأقل لربطه بالباتش.». (`«سجل تقدم إنتاج الأصناف:»` only renders when `items.length > 0`, but `startEdit` always sets `items = []` — dead UI.)
- Table: «رقم الباتش»/«تاريخ البدء»/«تاريخ الانتهاء»/«أُلغيت في»/«الملاحظات»/«الطلبات المتضمنة» («N طلبات»)/«الحالة»/«الإجراءات»; empty «لا توجد باتشات» (+ variants); pager «الصفحة X من Y (Z باتش)»/«← السابق»/«التالي →». No internal navigation (creation via sidebar `/dashboard/add-batch`). Gates: `ViewProductionBatches`, `UpdateProductionBatch` (patch/start/complete/cancel; unused `POST /:id/produce`), `DeleteProductionBatch`.

### 7. AddBatch — `/dashboard/add-batch` (`pages/AddBatch/AddBatch.tsx`, 236 lines) — «إنشاء باتش إنتاج»
Purpose: create one production batch from selected sale orders.
- «باتشات»/«إنشاء باتش إنتاج»/«أنشئ باتش تصنيع جديد باختيار الطلبات المرتبطة.»; spinner while `GET /sales/orders?type=SALE&pageSize=200` (eligible = not CANCELLED/RETURNED, client-side; «حدث خطأ أثناء تحميل الطلبات.»).
- «ملاحظات الباتش *» (`"مثال: دفعة بطانيات شتاء ٢٠٢٦"`, required «يرجى إدخال ملاحظات الباتش.»), «تاريخ البدء» (default today); «اختر الطلبات المتضمنة في الباتش *» + hint; order search «بحث برقم الطلب أو اسم العميل...», filter «الكل»/«عجز مخزون»/«بدون عجز»; checkbox rows (order no., «| العميل: …», `"(N أصناف)"`, «⚠️ عجز مخزون»); pager; empty «لا توجد طلبات متوفرة للجدولة حالياً.»; preview «📈 الكميات المجمعة للدفعة:».
- «إلغاء» → `navigate('/dashboard/production)`; «إنشاء الباتش»/«جاري الإنشاء...» → `POST /production/batches {notes, startDate, orderIds}` → `navigate('/dashboard/production')`; validation «يجب اختيار طلب واحد على الأقل لربطه بالباتش.». Gates: `ViewOrders` + `CreateProductionBatch`.

### 8. AccountingOverview — `/dashboard/accounting-overview` (`pages/AccountingOverview/AccountingOverview.tsx`, 191 lines) — «الحسابات والتقارير المالية»
Purpose: read-only P&L-style KPIs + orders-based financial ledger table (order revenue — the money-made-from-orders view).
- «الحسابات والتقارير المالية»/«ملخصات قائمة الدخل والميزانية وتفاصيل العمليات المالية المسجلة على النظام.»; parallel `GET /reports/overview/orders` + `GET /sales/orders?page&pageSize=10&search`.
- KPI: «إجمالي المبيعات الإجمالية (Gross)», «إجمالي قيمة المرتجعات (Loss)», «صافي الأرباح التشغيلية (Net)», «الطلبات المُسلَّمة (Delivered)» (`"من X طلب"`).
- Panel «دفتر الأستاذ المالي»: search «بحث برقم الفاتورة أو اسم العميل...» (server, resets page 1); table «تاريخ الحركة»/«الحالة التشغيلية» (جديد/مؤكد/مؤجل/ملغي/لا يرد/تم التسليم/مرتجع/لم يُسلّم/في الطريق/رُجع للمخزن + «عجز» badge)/«رقم السند/الفاتورة»/«نوع الحركة» (بيع/مرتجع/استبدال)/«المستفيد/العميل»/«مصاريف الشحن»/«الخصم المطبق»/«صافي القيمة المحصلة»; loading «جاري التحميل...»; empty «لا توجد نتائج»/«لم يتم العثور على حركات تطابق معايير البحث.»; pager «السابق»/«التالي»/«الصفحة X من Y (Z سجل)». No navigation. Gates: `ViewReports, ViewOrders`.

### 9. Reports — `/dashboard/reports`, `/dashboard/reports/stock`, `/dashboard/reports/locations` (same `Reports` screen; `stock`/`locations` differ only in initial tab; `pages/Reports/Reports.tsx`)
Purpose: per-product stock report + (placeholder) per-location breakdown. «التقارير»/«تقارير المخازن (Reports)»/«تقرير المخزون الإجمالي لكل منتج وتوزيع الكميات على مواقع التخزين.»; chip «N صف»; «تحديث» → `GET /reports/stock?pageSize=200` («تعذر تحميل التقارير.»).
- Tabs «تقرير المخزون» (BoxIcon) / «تقرير المواقع» (MapPinIcon) → `navigate('/dashboard/reports/stock' | '/dashboard/reports/locations')` (initial tab from URL); «آخر تحديث HH:MM».
- Stock table: #/«المنتج»/SKU/«إجمالي المتاح»/«الحد الأدنى» (always «—» — endpoint doesn't provide it)/«الحالة» («نفذ» red 0 / «متوفر» green). Locations tab always `EmptyState` — no per-location endpoint wired (breakdown "lives on the product stocks screen instead"). Gates: `ViewReports, ViewInventory` (`reports/stock.ts`; `GET /reports/stock/totals` exists but unused here).

Verification: all 9 page components, `lib/api/{purchasing,production,reports,sales,catalog}.ts`, route files, `lib/pageRoute.ts`, `navConfig.tsx`, backend route modules + handler verbs/permissions read. Unwired-but-existing endpoints from these pages: `POST /production/batches/:id/produce`, `GET /production/planning/*`, `GET /reports/stock/totals`. Documented quirks (decorative consignment search, `completionDate` never sent, «مخطط» no-op, dead progress block, locations tab always empty, «الحد الأدنى» always «—») as-found in source. (Wallet/ledger/payout pages + `/finance` removed 2026-09-13 — no subscription or wallet while the platform has no tax ID.)

## System A — api keys, apps, integrations, stores

### A1. ApiKeysManagement — `/dashboard/api-keys`
**Purpose:** Manage programmatic API keys for external integrations. Route `routes/_app/dashboard/api-keys.tsx` (no per-route `beforeLoad`). Nav «الإعدادات» (`ManageSettings`), item «المفاتيح البرمجية».
- «إنشاء مفتاح» → `startAdd()` (clears form, opens editor). Refresh → `load()`.
- «اسم المفتاح» (`#apikey-name`, «مثال: تكامل المتجر الإلكتروني») → `setName`. «تنتهي في (اختياري)» (`#apikey-expiry`, date) → `setExpiresAt`.
- Save/cancel (`EditorActions`) → `submit()` / `closeForm()`. Validates non-empty name («يرجى إدخال اسم المفتاح.»); edit closes form, create keeps it open showing the one-time secret.
- One-time secret «المفتاح المُنشأ (انسخه الآن)» + «نسخ» → `copyKey()` (`navigator.clipboard.writeText`; «تم نسخ المفتاح إلى الحافظة.» / «تعذر النسخ إلى الحافظة، انسخه يدوياً.»).
- Row «تعديل» («تعديل الاسم أو تاريخ الانتهاء») → pre-fills (expiry `slice(0,10)`). Row «إبطال» (only `isActive`) → one-way revoke («تم إبطال المفتاح.»). Row «حذف» → `confirm("هل أنت متأكد من حذف المفتاح «…»؟ لا يمكن التراجع عن هذه الخطوة.")` → «تم حذف المفتاح بنجاح.».
- Backend (`modules/system/apiKeys.ts`): `GET /system/api-keys` (`ViewApiKeys`); `POST /system/api-keys` (`ManageApiKeys`; returns one-time `token`; 409 past `MAX_API_KEYS_PER_COMPANY`); `PATCH /:id`, `POST /:id/revoke` (`isActive:false`, `revokedAt`), `DELETE /:id` (soft-delete) — all `ManageApiKeys`.
- No navigation. Columns: الاسم، المفتاح (prefix + `••••••`)، الحالة («نشط»/«معطل»)، أُنشئ في، أُنشئ بواسطة، آخر استخدام، ينتهي في، أُلغي في. No in-page gate (backend-only); nav needs `ManageSettings`.

### A2. AppsManagement — `/dashboard/apps`
**Purpose:** Static hub of integration cards linking out to real pages. Heading «الإضافات والربط»; externally-linked integrations marked «(قريباً)». Nav module «الإضافات» (`ViewStores`), item «الإضافات والربط».
- Card «Shopify» — «ربط متجر Shopify» («يتطلب ربط خارجي») → `navigate('/dashboard/stores')`.
- Card «مفاتيح API — Mawzun AI» — «إدارة المفاتيح» («متاح») → `navigate('/dashboard/api-keys')`.
- Card «أخطاء المزامنة» — «عرض الأخطاء» («متاح») → `navigate('/dashboard/sync-errors')`.
- Three cards only; no clipboard affordance and no backend calls. No in-page gate.

### A3. Integrations — `/dashboard/integrations`
**Purpose:** Manage shipping carriers and default prices (despite the route name, this is the carriers directory). Nav «الإعدادات» (`ManageSettings`), item «التكاملات والباقات». Eyebrow «المنصة», «شركات الشحن», «إدارة شركات التوصيل المتكاملة وأسعار الشحن الافتراضية لكل شركة.».
- «شركة جديدة» (toggles form, resets) → `submit()`. Form: «الاسم» (required), «الكود» (required, auto-uppercase; auto `"CAR-" + Date.now().toString(36)` when empty), «رابط الشعار» (optional), «سعر الشحن»/«سعر العميل»/«سعر المرتجع» (numeric), «نشطة», «إرسال تلقائي» → save/cancel. Notices «تم إضافة/تحديث شركة الشحن.» / «تعذر حفظ شركة الشحن.».
- Row «تعديل» → pre-fills + opens editor. Row «حذف» → confirm («حذف …؟») + reload («تعذر الحذف.»).
- Table: الشركة، المفتاح (code, ltr)، سعر الشحن، سعر العميل، الإرسال التلقائي («نعم»/«لا»)، الحالة; chip «N شركة».
- Backend (`lib/api/shipping.ts` → `modules/shipping/carriers.ts` at `/shipping/carriers`): list/detail need `ViewCarriers`; writes need `ManageCarriers`. No navigation.
- Gate: `canManage = isReady && (isCompanyOwner || hasPermission('ManageCarriers'))` gates «شركة جديدة» + row edit/delete; list ungated. Nav needs `ManageSettings`.

### A4. StoresManagement — `/dashboard/stores`
**Purpose:** Manage connected e-commerce stores (custom + Shopify) + historical Shopify backfill. Route `routes/_app/dashboard/stores.tsx`. Nav: «البيانات الأساسية» → «المتاجر المربوطة» (ungated) + «الإضافات» (`ViewStores`). Eyebrow «التكاملات», «المتاجر المربوطة (Stores)», «متاجر البيع الإلكتروني المتصلة بالنظام لمزامنة المنتجات والطلبات.».
- Search «ابحث باسم المتجر أو الرابط...» → client filter (name + `storeUrl`). Refresh → `load()`; chip «N متجر». «إضافة متجر» → `startAdd()` (defaults CUSTOM, active).
- Form: «اسم المتجر» («مثال: متجر الموزون الرسمي»), «المنصة» («مخصص»/«Shopify»; Shopify disabled «Shopify — معطّل (استضف نسختك الخاصة)» when switch off), «رابط المتجر» (`"https://..."`, ltr), «متجر نشط» → save/cancel; validation «يرجى إدخال اسم المتجر.»; «تمت إضافة/تحديث المتجر بنجاح.» / «تعذر حفظ البيانات.».
- Row edit/delete → `startEdit` / `remove()` (confirm «هل أنت متأكد من حذف المتجر «…»؟», «تم حذف المتجر بنجاح.»/«تعذر حذف المتجر.»).
- «استيراد الطلبات السابقة» (only `platform === 'SHOPIFY' && shopifyEnabled`; «جارٍ الاستيراد...») → `backfill(item)` — `prompt("استيراد الطلبات السابقة من «…».\nأدخل التاريخ (اتركه فارغاً لآخر 90 يوماً):")`, bad date → «التاريخ غير صالح.»; notice `تم جلب N طلب — جديد: … — مكرر: …` + `أصناف غير مطابقة: N (راجع أخطاء المزامنة)` + `لم تكتمل — اضغط مرة أخرى للمتابعة` when `!done`.
- Shopify-disabled banner (when `!shopifyEnabled`): «مزامنة Shopify معطّلة على هذا الحساب.» + `docs.mawzun.org` link; store URL as external `<a target="_blank">`.
- Backend (`modules/system/stores.ts`, backfill router): `GET /system/stores` (`ViewStores`); `POST` (`ManageStores`; SHOPIFY needs kill-switch + quota + secrets); `PATCH /:id`, `DELETE /:id` (soft) (`ManageStores`); `POST /:id/backfill` (`ManageStores`); `GET /settings` drives `shopifyEnabled` (failure defaults `true`).
- No in-app navigation (external links only). Columns: الاسم، المنصة («Shopify»/«مخصص»)، الرابط، آخر مزامنة («لم تتم المزامنة بعد» or date + «N خطأ»), الحالة. No in-page gate (backend-only).

## System B — sync errors, settings, cities, governorates

### B1. SyncErrors — `/dashboard/sync-errors` (`pages/SyncErrors/SyncErrors.tsx`)
Purpose: work through order/product sync failures (resolve / ignore / retry). Sidebar «أخطاء المزامنة» under «الإعدادات» (`ManageSettings` on group; no per-item permission). Backend: list needs `ViewSyncErrors`, mutations need `ManageSyncErrors` (`syncErrors.ts`).
- Search «ابحث بالمتجر أو رقم الطلب الخارجي...» → state; list refetches via effect (no search button): `GET /system/sync-errors?search=&status=&page=&pageSize=20`.
- Status «الحالة:» («الكل»/«قيد الانتظار»/«تم الحل»/«مُتجاهل») → page 1 + same GET (`status=PENDING|RESOLVED|IGNORED`). «تحديث» → reload.
- «تعليم الكل كمُحلَّل» (only when some `PENDING`; confirm «تعليم كل أخطاء المزامنة المعلّقة كمُحلَّلة؟») → `POST /system/sync-errors/resolve-all` → «تم تعليم N خطأ كمُحلَّل.».
- Row message button (truncated `errorMessage`, «عرض/إخفاء الرسالة الكاملة») → expands full LTR message inline; local only.
- Row «↻» («إعادة المحاولة», only `PENDING`) → `POST /:id/retry` (re-fetches Shopify payload for retryable types; max 10 retries) → «أُعيدت جدولة المحاولة (محاولة رقم N).».
- Row «⊘» («تجاهل الخطأ», only `PENDING`; confirm «تجاهل خطأ المزامنة …؟») → `POST /:id/ignore` → «تم تجاهل الخطأ.».
- Row «✓» («تعليم كمُحلول», only `PENDING`) → `POST /:id/resolve` → «تم تعليم الخطأ كمُحلول.».
- «السابق»/«التالي» + «صفحة N من M — N خطأ». No navigation, no links out.

### B2. SystemSettings — `/system-settings` (`pages/SystemSettings/SystemSettings.tsx`)
Purpose: admin shell of tabbed reference-data, company-settings, and account/security screens. Gates (`useCurrentUser`): `canManageSettings = isReady && (isCompanyOwner || hasPermission('ManageSettings'))`; `hasViewBrands`/`hasViewCategories`/`hasViewWarehouses`. `!isReady` → «جاري تحميل صلاحياتك...». Non-privileged see only «الحساب» + «إنهاء الجلسة»; without `ManageSettings` reference tabs never render.
- Tabs (right nav «أقسام الإعدادات», `setActiveTab`, no URL change):
  - «الحساب» (`account`, «كلمة المرور») — always visible. «كلمة المرور الحالية»/«الجديدة»/«التأكيد» + «حفظ كلمة المرور» → `POST /auth/change-password` → «تم تغيير كلمة المرور بنجاح.». «رابط صورة الحساب» + «رفع صورة» (hidden file via `useFilePicker` → R2) + «حفظ الصورة» → `GET /auth/me` then `PATCH /users/:id { avatarUrl }`, persists `profilePictureUrl` + `profile-picture-changed` event.
  - «حساب جديد» (`register`, admin-only) — «الاسم الكامل»/«البريد الإلكتروني»/«كلمة المرور»/«رقم الهاتف» + «الدور» (from `GET /roles?pageSize=100`) + «تسجيل الحساب» → `POST /users { fullName, email, password, phoneNumber, roleIds }` → «تم تسجيل الحساب بدور X بنجاح.».
  - «إعادة تعيين» (`admin-reset`, admin-only) — «المستخدم» (from `GET /users?pageSize=200`) + «كلمة المرور الجديدة» + «تحديث كلمة المرور» → `POST /users/:id/reset-password { newPassword }` → «تم تحديث كلمة مرور المستخدم X بنجاح.».
  - «بيانات الشركة» (`set-company`) — no form; «فتح ملف الشركة» → `navigate('/dashboard/company')`.
  - «إعدادات المحاسبة»/«المخزون»/«المشتريات»/«المبيعات»/«الشحن» — each `SettingsSection(findSection(id))`. Fields («بداية السنة المالية»، «بادئة رقم الفاتورة»، «نسبة ضريبة المبيعات الافتراضية %»، «خصم الكمية عند»، «السماح بالبيع بالسالب»، «بادئة رقم أمر الشراء»، «بادئة رقم الطلب»، «تكلفة الشحن الافتراضية»…) load `GET /settings`, save field-by-field `PATCH /settings` (GET needs `ManageSettings|ViewProducts`, PATCH `ManageSettings`).
  - «المحافظات»/«المدن» — embed `<GovernoratesManagement embedded>` / `<CitiesManagement embedded>` (same handlers/endpoints as B3/B4; default landing `governorates` when permitted).
  - «مصادر الطلبات»/«طرق الدفع»/«شركات الشحن» — embed respective `*Management … embedded` screens.
  - «الماركات»/«الأقسام»/«المستودعات» — gated by view grants; without grant → locked card «إعدادات النظام مقفلة» + «لا توجد صلاحية كافية…».
  - «إنهاء الجلسة» (`revoke-token`) — «إنهاء الجلسة وتسجيل الخروج» (confirm «سيتم إنهاء جلستك الحالية…؟») → `POST /auth/logout` → «تم إنهاء الجلسة. جارٍ تحويلك لتسجيل الدخول...» → `navigate('/login')` after 900 ms.
- Navigates: `/dashboard/company` (shortcut), `/login` (after logout). Rest in-page.

### B3. CitiesManagement — canonical `/dashboard/directory?tab=cities`; legacy `/dashboard/cities` redirects; also embedded SystemSettings «المدن» tab
Purpose: CRUD cities bound to one governorate (name, code, shipping cost, active). No in-component gate (relies on SystemSettings gate / sidebar grouping); backend: reads need `ViewCarriers|ViewOrders`; writes need `ManageCarriers` (`cities.ts`).
- «تحديث» → `GET /shipping/cities` (flat lookup); governorates from `GET /shipping/governorates` (once).
- «إضافة مدينة» (disabled when no governorates; hint «أضف محافظة أولاً حتى تتمكن من إنشاء المدن.») → editor «إضافة مدينة» («اسم المدينة» e.g. «مثال: مدينة نصر», «المحافظة» «اختر المحافظة», «الكود» e.g. `CAI-NSR`, «تكلفة الشحن (ج.م)», «مدينة نشطة»; «إلغاء» local; «إضافة السجل» → `POST /shipping/governorates/:governorateId/cities` → «تمت إضافة المدينة بنجاح.»; validation «يرجى إدخال اسم المدينة واختيار المحافظة.»).
- Search «ابحث باسم المدينة أو المحافظة...» + «كل المحافظات» filter → client-side (server only paginates). Row edit (pencil `تعديل X`) → «تعديل مدينة» with «المحافظة» **disabled** (parent immutable — move = delete + recreate) → «حفظ التعديل» → `PATCH /shipping/governorates/:governorateId/cities/:cityId` → «تم تحديث المدينة بنجاح.». Row delete (`حذف X`; confirm «هل أنت متأكد من حذف المدينة …؟») → `DELETE …/:cityId` (backend 409 «لا يمكن حذف مدينة مستخدمة في طلبات.») → «تم حذف المدينة بنجاح.».
- «السابق»/«التالي» + «الصفحة N من M (N مدينة)» (local slice, 20/page). Columns: `#`/«المدينة»/«المحافظة»/«الكود»/«تكلفة الشحن»/«الحالة» («نشطة»/«موقوفة»). No navigation.

### B4. GovernoratesManagement — canonical `/dashboard/directory?tab=governorates`; legacy `/dashboard/governorates` redirects; also embedded SystemSettings «المحافظات» tab
Purpose: CRUD governorates (name, code, shipping cost, active) with city-count column. Same gate pattern; backend `defineResource` (`governorates.ts`): view `ViewCarriers|ViewOrders`, manage `ManageCarriers`. Mounted `/shipping/governorates`.
- «تحديث» → `GET /shipping/governorates`. «إضافة محافظة» → «إضافة محافظة» («الاسم» e.g. «مثال: القاهرة», «الكود» e.g. `CAI`, «تكلفة الشحن (ج.م)», «محافظة نشطة»; «إلغاء» local; «إضافة السجل» → `POST /shipping/governorates` → «تمت إضافة المحافظة بنجاح.»; validation «يرجى إدخال اسم المحافظة.»).
- Search «ابحث في المحافظات...» → client-side filter. Row edit (`تعديل X`) → «تعديل المحافظة» → «حفظ التعديل» → `PATCH /shipping/governorates/:id` → «تم تحديث المحافظة بنجاح.». Row delete (`حذف X`; confirm «هل أنت متأكد من حذف المحافظة …؟») → `DELETE /:id` (backend 409 «لا يمكن حذف محافظة مستخدمة في مدن أو طلبات.») → «تم حذف المحافظة بنجاح.».
- «السابق»/«التالي» + «الصفحة N من M (N محافظة)» (local, 20/page). Columns: `#`/«الاسم»/«الكود»/«تكلفة الشحن»/«الحالة»/«المدن» (`_count.cities`). No navigation.

## Admin (company & access)

All routes under `/_app` (login-required; `route.tsx` redirects to `/login?redirect=…`, `SessionGate` revalidates `/auth/me`) except platform routes under `/_platform`. Screens take `navigate(path)` via `asRoute()`; nothing uses `<Link>`.

### 1. Users — `/users` (`pages/Users/Users.tsx` ← `routes/_app/users.tsx`)
Manage members: search, filter, group, add, change role, suspend/activate, reset password, delete. «إدارة المستخدمين», «أنشئ حسابات الموظفين وحدد أدوارهم وحالات حساباتهم للتحكم في وصولهم للسيستم».
- Search «البحث بالاسم، البريد أو الهاتف...» → `GET /users` (`usersApi.list({search, page, pageSize:20})`).
- «فلترة» popover → «البحث بالاسم / بالبريد / برقم الهاتف» + «حالة المستخدم» (الكل/نشط/غير نشط/بانتظار القبول) → client filter on loaded page; «إعادة ضبط الفلاتر» clears.
- «تجميع حسب» popover («الحالة», «بحث») → groups rows by status; «إلغاء التجميع» clears.
- «الأعمدة» popover → toggles name/email/phone/role/status/lastLogin columns; «اظهار الكل» restores.
- «إضافة مستخدم جديد» (drawer) → «اسم المستخدم *», «البريد الالكتروني *», «رقم الهاتف», «المسمى الوظيفي», «الرقم السري * (٨ أحرف على الأقل)» (show/hide), «الأدوار» multi-select → `POST /users` (own-company member, not registration; capped at `MAX_USERS_PER_COMPANY`); «إلغاء» closes, «إضافة المستخدم» saves + reloads.
- Row: role pill («تغيير الدور» popup, «جاري تحميل الأدوار...» while loading) → `PATCH /users/:id {roleIds}`; «كلمة المرور» → `window.prompt` («أدخل كلمة المرور الجديدة…») → `POST /users/:id/reset-password`; «تعطيل»/«تفعيل» → confirm → `PATCH /users/:id {status}`; «حذف» → confirm → `DELETE /users/:id`. Owner row badge «المالك» with no suspend/delete/role controls (`GET /company` provides `owner.id`).
- Pagination «السابق»/«التالي»; error banner + «إعادة المحاولة». Backend (whole router under `requirePermission(ManageUsers)`): `GET/POST /users`, `PATCH/DELETE /users/:id` (refuses owner: `COMPANY_OWNER_PROTECTED`), `POST /users/:id/reset-password`. Gate: `canManageUsers = hasPermission('ManageUsers')` hides add + locks role editor; sidebar «الإعدادات» module needs `ManageSettings`. No onward navigation.

### 2. Roles — tab `roles` of `/access` (`pages/Roles/Roles.tsx`)
Define job roles and grants. «إدارة الحماية والصلاحيات», «أدوار ومجموعات صلاحيات الموظفين». Old `/roles` redirects (`mergedRedirectTarget('/roles')` = `/access?tab=roles`).
- `GET /roles` + `GET /roles/permissions` in parallel. Search «ابحث عن دور...» → page 1.
- «+ إضافة دور جديد» → drawer («دور وظيفي جديد»): «اسم الدور الوظيفي», «وصف الدور», per-category checkbox groups with «تحديد الكل»/«إلغاء تحديد الكل» → `POST /roles`; «إلغاء» closes, «إضافة الدور»/«جاري الحفظ...» submits.
- Card per role («صلاحيات N», «مستخدمين N», granted-label chips, «لا توجد صلاحيات معطاة بعد» if empty): «تعديل الصلاحيات ←» → edit mode («تحرير الصلاحيات», «تعديل الدور …», Admin name locked «لا يمكن تغيير اسم دور المدير الرئيسي…») → `PATCH /roles/:id`; «حذف الدور» (hidden for `Admin`) → confirm → `DELETE /roles/:id`. `isSystem` Admin delete refused («لا يمكن حذف دور مدير النظام الرئيسي (Admin).»).
- Pagination «السابق»/«التالي» + numbered pages. Backend: reads need `ManageRoles` or `ManageUsers`; writes need `ManageRoles`. No page-level gate; via Settings sidebar (`ManageSettings`) and `/access` tabs. Stays, reloads.

### 3. Permissions — tab `permissions` of `/access` (`pages/Permissions/Permissions.tsx`)
Read-only catalogue of every permission key. «تهيئة الأمان المرجعية», «دليل صلاحيات النظام». Old `/permissions` → `/access?tab=permissions`.
- `GET /roles/permissions` («تعذر تحميل قائمة الصلاحيات من السيرفر.»). Search «ابحث عن صلاحية بالاسم أو الوصف أو الكود...» → by key/Arabic label/desc/category; «إجمالي الصلاحيات المعرفة بالنظام: N من أصل M صلاحية»; empty «لا توجد نتائج مطابقة لبحثك».
- Cards grouped «الصلاحيات الخاصة بـ {category}» (المستخدمين والأمن، المنتجات وكروت الصنف، المبيعات والمشتريات والطلبات، إدارة العملاء، المخازن ومواقع التخزين، التصنيع والإنتاج والتشغيل، إعدادات النظام العامة، أخرى), Arabic label + desc, mono key, badge «نشطة بالسيستم». No writes, no navigation, no page gate (backend `ManageRoles` or `ManageUsers`).

### 4. Access route — `/access` (`routes/_app/access.tsx`)
Tab shell merging Roles + Permissions: `?tab=roles|permissions` (default `roles`), sidebar tabs «الأدوار»/«الصلاحيات». No data load, no own permission check; sidebar entry «الأدوار والصلاحيات» under «الإعدادات» (`ManageSettings`).

### 5. CompanyProfile — `/dashboard/company` (`pages/CompanyProfile/CompanyProfile.tsx`)
Company identity + legal + contact + address + regional. «ملف الشركة», «البيانات التعريفية والقانونية لنشاطك كما تظهر على الفواتير والمستندات.» + status chip + facts («المالك», «المعرّف (slug)», «تاريخ الإنشاء», «الأعضاء», «المنتجات»).
- `GET /company` («تعذر تحميل بيانات الشركة.»; fatal «رجوع» → `navigate('/system-settings')`).
- Form (fieldsets `disabled` unless editable): «اسم الشركة *», «الاسم القانوني» («الاسم المسجل رسمياً»), «الرقم الضريبي», «السجل التجاري» | «بيانات التواصل»: «البريد الإلكتروني», «الهاتف», «الموقع» | «العنوان»: «الشارع / العنوان», city, «المحافظة / المنطقة», country, «الرمز البريدي» | regional: «العملة», «المنطقة الزمنية», locale, fiscal-year-start month → «حفظ البيانات»/«جاري الحفظ...» → `PATCH /company` → «تم حفظ بيانات الشركة بنجاح.»; viewers see «ليس لديك صلاحية تعديل بيانات الشركة…».
- Backend: `GET /company` membership only; `PATCH /company` needs `ManageSettings`. Gate: `canEdit = isCompanyOwner || hasPermission('ManageSettings')`.

### 6. ShippingCompaniesManagement — `/dashboard/shipping-companies` (`pages/ShippingCompaniesManagement/ShippingCompaniesManagement.tsx`)
Reference data: delivery carriers and costs. «بيانات مرجعية», «شركات الشحن», «شركات التوصيل المستخدمة لتنفيذ الطلبات.». Sidebar «شركات الشحن».
- Toolbar: «N شركة شحن», «تحديث» → `GET /shipping/carriers?pageSize=200`; «إضافة شركة شحن» → editor; search «ابحث في شركات الشحن...» → client filter.
- Editor («إضافة شركة شحن»/«تعديل شركة الشحن», «سجل جديد»/«تعديل السجل»): «الاسم» («مثال: أرامكس»), «الكود» (immutable after create «ثابت بعد الإنشاء»; auto-derived if blank «يُشتق تلقائيًا عند تركه فارغًا»), «النوع» («يدوية»/«مدمجة»), «قالب رابط التتبع», «تكلفة الشحن الافتراضية (ج.م)», «تكلفة الشحن على العميل (ج.م)», «تكلفة الإرجاع (ج.م)», «نشطة», «إرسال الطلبات تلقائيًا» → `POST /shipping/carriers` / `PATCH /:id`; «إلغاء» closes, «إضافة السجل»/«حفظ التعديل» submits.
- Table: #, «الاسم», «الكود», «النوع», «تكلفة الشحن», «على العميل», «الإرجاع», «الحالة», «الطلبات», «الإجراءات»: expand («عرض نسب النجاح حسب المدينة») → `GET /reports/carriers/:carrierId/city-success-rate` («المدينة/المؤكدة/المسلّمة/المرتجعة/نسبة النجاح»); «تعديل»; «حذف» → confirm («هل أنت متأكد من حذف شركة الشحن …؟») → `DELETE /:id`.
- Backend (`carriers.ts`, `/shipping/carriers`): list needs `ViewCarriers`, writes need `ManageCarriers`. No page-level gate found.

### 7. ShippingOverview — `/dashboard/shipping-overview` (`pages/ShippingOverview/ShippingOverview.tsx`)
Dispatch board: carrier KPIs + shipment-status workflow. «لوحة عمليات الشحن», «جدولة خروج الطلبات مع شركات الشحن المختلفة وتسجيل حالات تسليم الطرود.». Sidebar «عمليات الشحن».
- Load (parallel): `GET /reports/overview/shipping` (needs `ViewReports` or `ViewOrders`; KPIs «إجمالي الشحنات … طرد» etc.), `GET /sales/orders`, `GET /reports/carriers/most-used|fastest|success-rate|cost-stats` (`top:5`).
- Carrier tabs: «الأكثر استخدامًا»/«نسبة النجاح»/«الأسرع» (+ cost table) switch ranking table.
- Filters: search «بحث برقم الطلب أو اسم العميل أو الهاتف...», status («كل الحالات», «تم التأكيد», «في الطريق», «لم يسلم», «تم الإرجاع»).
- Table («رقم الطلب», «العميل», «الهاتف», «المحافظة», «العنوان بالتفصيل», «شركة الشحن», «تكلفة الشحن», «الحالة الحالية», «إجراءات حركة الشحن»): row click expands items; status buttons by state — CONFIRMED: «خروج للتوصيل» → `ON_THE_WAY`; ON_THE_WAY: «تم التسليم»/«لم يسلم»/«تم الإرجاع»; NOT_DELIVERED/RETURNED: «إرجاع للمستودع» — all `POST /sales/orders/:id/status` (needs `UpdateOrder`), then reload.
- Pagination «السابق»/«التالي». No page-level gate found.

### 8. Directory route — `/dashboard/directory` (`routes/_app/dashboard/directory.tsx`)
Tab shell for six reference screens: `?tab=brands|categories|uom|reasons|governorates|cities` (default `brands`), sidebar «الماركات»/«الأقسام»/«وحدات القياس»/«الأسباب»/«المحافظات»/«المدن». Sidebar «البيانات المرجعية» under «البيانات الأساسية». Old paths redirect to matching tab. No data load or gate in the shell.

### 9. Test route — `/test` (`routes/_app/test.tsx` ← `pages/ScannerTest/ScannerTest.tsx`)
Dev-only HID barcode-scanner bench. No inputs/buttons/navigation/endpoints/permissions: focus page → `keydown` accumulates fast bursts, `Enter` ends burst, shows live text + `last scan: […] len=… avgGap/minGap/maxGap/duration` + raw key log; `Ctrl+Shift+R` resets. Production renders only «هذه شاشة تجريبية للفريق التقني فقط.». No sidebar entry.

### 10. PlatformCompanies — `/platform/companies` (`pages/PlatformCompanies/PlatformCompanies.tsx` + `routes/_platform/*`)
Back-office directory of every company. «إدارة المنصة», «دليل الشركات», «كل الشركات المسجلة على المنصة, وحالتها, ومالكها.». Not in company sidebar.
- `GET /platform/companies` (search, status, page, pageSize). Search «ابحث باسم الشركة...» + status («كل الحالات», «تجريبية», «نشطة», «معلقة», «مغلقة»); «N شركة»; «تحديث» reloads.
- Table («الشركة»+slug, «الحالة», «المالك»+email, «المستخدمون», «المنتجات», «الطلبات», «تاريخ الإنشاء», «الإجراءات»): «تغيير الحالة» → dialog («تغيير حالة الشركة»): «الحالة الجديدة» («تجريبية»/«نشطة»/«معلقة»/«مغلقة»), «السبب» (required for suspend/close «يُسجَّل هذا السبب في سجل التدقيق…»; warns suspend «سيتم إنهاء جميع الجلسات النشطة…») → `PATCH /platform/companies/:id/status` → «تم تغيير حالة شركة … إلى ….»; «إلغاء» closes, «تأكيد التغيير»/«جاري الحفظ...» submits.
- Backend (`company.routes.ts`, mounted `/platform`): `GET /companies`, `PATCH /companies/:id/status` under `requirePlatformAdmin()` (companyId = null; 403 otherwise; reason required for SUSPENDED/CLOSED).
- Gates: `/_platform/route.tsx` redirects unauthenticated → `/login`; non-platform user → `/dashboard/sales-overview` (notice «هذه الشاشة متاحة لإدارة المنصة فقط.»); `/platform/` index → `/platform/companies`.

