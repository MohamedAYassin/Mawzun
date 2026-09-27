import { createFileRoute, redirect } from "@tanstack/react-router";

// `/signup` and `/register` were both accepted for years. Registration is one
// screen, so the older address points at it rather than duplicating it.
export const Route = createFileRoute("/_public/signup")({
  beforeLoad: () => {
    throw redirect({ to: "/register", replace: true });
  },
});
