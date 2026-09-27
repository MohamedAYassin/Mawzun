import { createFileRoute, redirect } from "@tanstack/react-router";

// The company directory is the platform surface's home.
export const Route = createFileRoute("/_platform/platform/")({
  beforeLoad: () => {
    throw redirect({ to: "/platform/companies", replace: true });
  },
});
