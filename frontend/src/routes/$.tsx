import { createFileRoute } from "@tanstack/react-router";

import { asRoute } from "../lib/pageRoute";
import NotFound from "../pages/NotFound/NotFound";

// Anything the route tree does not know. The screens are Arabic and the shell
// is RTL, so the not-found screen is too — the root route's own
// `notFoundComponent` only shows if a route throws `notFound()`.
export const Route = createFileRoute("/$")({
  head: () => ({
    meta: [{ name: "robots", content: "noindex" }],
  }),
  component: asRoute(NotFound),
});
