import { createFileRoute } from "@tanstack/react-router";

import OrderInvoice from "../../../../../pages/OrderInvoice/OrderInvoice";
import { usePageNavigate } from "../../../../../lib/navigation";

// Invoice screen: reads the order id from the route params directly — the
// screen takes `orderId` in addition to `navigate`, so it does not reuse the
// bare asRoute adapter. Navigation still goes through the router seam so the
// route guards apply.
export const Route = createFileRoute("/_app/dashboard/orders/$orderId/invoice")({
  component: function InvoiceRoute() {
    const { orderId } = Route.useParams();
    const navigate = usePageNavigate();
    return <OrderInvoice orderId={orderId} navigate={navigate} />;
  },
});
