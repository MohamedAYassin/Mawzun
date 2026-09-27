import { http } from "./http";

// Live sessions for the signed-in user, and the ability to end them.
//
// The backend decides the scope from the caller's permissions, so the same
// endpoint returns either "mine" or "everyone in the company" — the client
// never asks for a scope, because asking would mean trusting the client to
// choose one. `scope` comes back so the UI can label the list honestly.

export interface SessionUserRef {
  id: string;
  fullName: string;
  email: string;
}

export interface ActiveSession {
  id: string;
  /** Raw User-Agent string; may be null for non-browser clients. */
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
  expiresAt: string;
  /** The session making this request. Ending it signs the caller out. */
  isCurrent: boolean;
  user: SessionUserRef;
}

export interface SessionList {
  sessions: ActiveSession[];
  /** `company` only for callers holding Permissions.ManageUsers. */
  scope: "own" | "company";
}

export interface RevokeSessionResult {
  id: string;
  /** False when the session was already ended (the call is idempotent). */
  revoked: boolean;
  alreadyRevoked: boolean;
  /** Present when the caller ended their own session. */
  wasCurrent?: boolean;
}

export const sessionsApi = {
  list: () => http.get<SessionList>("/system/sessions"),
  revoke: (id: string) => http.delete<RevokeSessionResult>(`/system/sessions/${id}`),
};
