import { Outlet, createFileRoute } from "@tanstack/react-router";

// Routes this home deployment serves: the landing only. The auth screens
// (login/register/forgot-password) live in the frontend deployment, and
// `usePageNavigate` exits to that origin for their paths.
//
// The underscore prefix makes this a *pathless* layout — it contributes no URL
// segment, only the grouping everything under it inherits.
export const Route = createFileRoute("/_public")({
  component: PublicLayout,
});

function PublicLayout() {
  return <Outlet />;
}
