import { createFileRoute, Outlet, useMatchRoute } from "@tanstack/react-router";

import { asRoute } from "../../../lib/pageRoute";
import OrderManagement from "../../../pages/OrderManagement/OrderManagement";

// `orders/$orderId/invoice` nests under this route, so this file became a
// layout. Rendering OrderManagement unconditionally would swallow the invoice
// child: the exact-match check keeps the list at /dashboard/orders while the
// child route renders through <Outlet /> at /dashboard/orders/$orderId/invoice.
//
// The screen component is built ONCE at module level. Calling
// asRoute(OrderManagement)() during render was a hooks-order violation: that
// call runs usePageNavigate(), so the list rendered two hooks while the invoice
// branch (the early return) rendered one, and React threw "Rendered fewer hooks
// than expected" — the invoice page landed on the error boundary and only
// recovered after pressing إعادة المحاولة, which remounted the route fresh.
const OrdersList = asRoute(OrderManagement);

export const Route = createFileRoute("/_app/dashboard/orders")({
  component: function OrdersLayout() {
    const matchRoute = useMatchRoute();
    const isExact = matchRoute({ to: "/dashboard/orders", fuzzy: false });
    if (!isExact) return <Outlet />;
    return <OrdersList />;
  },
});
