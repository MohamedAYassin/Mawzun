import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

// No router context: this deployment is a static landing page. It used to carry
// a react-query QueryClient in context, but nothing ever consumed it (no
// useQuery/useMutation anywhere), so it was pure bundle weight.
export const getRouter = () => {
  const router = createRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
