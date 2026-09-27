import { useQuery } from "@tanstack/react-query";
import { authApi, session, type Principal } from "../lib/api";

// Who the caller is, and what they are allowed to do.
//
// This replaces reading role *names* out of localStorage, which was the source
// of several bugs:
//
//   * the copy went stale the moment an admin revoked a role, so a user kept
//     seeing controls they could no longer use;
//   * it compared against the literal "Admin", so a renamed or custom role
//     silently granted nothing;
//   * it was client-side state used to make authorisation decisions, and the
//     client cannot be trusted with those anyway.
//
// The backend resolves permissions from the company's roles plus ownership on
// every request. This hook exposes that answer; it never decides for itself.

export const currentUserQueryKey = ["auth", "me"] as const;

export interface Capabilities {
  /** True once the principal has been fetched. */
  isReady: boolean;
  principal: Principal | null;

  /**
   * `/auth/me` failed. The distinction matters: "not loaded yet" and "the
   * server refused" are different UI states, and collapsing them into a single
   * loading flag is how a revoked session used to look like a slow network.
   */
  isError: boolean;
  error: Error | null;

  hasPermission: (permission: string) => boolean;
  /** The company's single owner. Immutable in the UI. */
  isCompanyOwner: boolean;
  /** Platform staff belong to no company and use the platform routes. */
  isPlatformAdmin: boolean;
  companyId: string | null;
}

const EMPTY: Capabilities = {
  isReady: false,
  principal: null,
  isError: false,
  error: null,
  hasPermission: () => false,
  isCompanyOwner: false,
  isPlatformAdmin: false,
  companyId: null,
};

export function useCurrentUser(): Capabilities {
  const { data, isSuccess, isError, error } = useQuery({
    queryKey: currentUserQueryKey,
    queryFn: () => authApi.me(),
    // Only ask who we are when there is a session to ask with.
    enabled: session.isAuthenticated,
    staleTime: 5 * 60 * 1000,
    // A 401 is answered by the transport: it clears the pair and fires
    // `mawzun:session-expired`. Retrying here would only delay the redirect.
    retry: false,
  });

  if (isError) {
    return { ...EMPTY, isError: true, error: (error as Error) ?? null };
  }

  if (!isSuccess || !data) return EMPTY;

  const granted = new Set(data.permissions);
  return {
    isReady: true,
    principal: data,
    isError: false,
    error: null,
    hasPermission: (permission: string) => granted.has(permission),
    isCompanyOwner: data.user.isCompanyOwner,
    isPlatformAdmin: data.user.isPlatformAdmin,
    companyId: data.user.companyId,
  };
}
