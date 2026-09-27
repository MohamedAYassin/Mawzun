import { Outlet, createFileRoute, redirect, useRouter } from "@tanstack/react-router";

import { session } from "../../lib/api";
import { useCurrentUser } from "../../hooks/useCurrentUser";
import { SessionGate } from "../../components/guards/SessionGate";

// The platform back-office: every company on the installation.
//
// Platform staff are users with `companyId = null` — they administer the
// installation rather than belong to one of its companies. That separation is
// enforced in the database and re-checked on every request, so this guard is
// the third of three, not the only one:
//
//   1. the invariant trigger refuses to give a platform account a company;
//   2. `/platform/*` routes require platform staff and company routes require a
//      company, so the two surfaces never overlap on the server;
//   3. this route keeps company users from ever *seeing* the directory.
//
// Step 3 is about honesty rather than safety — a company user clicking here
// would only ever get 403s — but a screen that can only fail is worse than no
// screen, so they are sent back to where they can do something.
export const Route = createFileRoute("/_platform")({
  beforeLoad: () => {
    if (typeof window !== "undefined" && !session.isAuthenticated) {
      throw redirect({ to: "/login", replace: true });
    }
  },
  component: PlatformLayout,
});

function PlatformLayout() {
  const router = useRouter();
  const { isReady, isPlatformAdmin } = useCurrentUser();

  // `SessionGate` already waited for the principal; by the time this renders,
  // the answer is known and there is nothing left to load.
  if (isReady && !isPlatformAdmin) {
    void router.navigate({ to: "/dashboard/sales-overview", replace: true });
    return null;
  }

  return (
    <SessionGate>
      <Outlet />
    </SessionGate>
  );
}
