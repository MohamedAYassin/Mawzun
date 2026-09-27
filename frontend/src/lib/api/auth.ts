import { announceSessionExpired, http, request, session } from "./http";

// Authentication and the current principal.
//
// The response shape changed with the company refactor: the backend now issues
// a token *pair* (`accessToken`/`refreshToken`) plus a `principal` describing
// who the caller is, which company they belong to, and what they can do. The
// old `token`/`isSuperAdmin` shape is gone.

export interface CompanySummary {
  id: string;
  name: string;
  slug: string;
  status: "ACTIVE" | "SUSPENDED" | "CLOSED";
}

export interface UserSummary {
  id: string;
  email: string;
  fullName: string;
  phoneNumber: string | null;
  avatarUrl: string | null;
  jobTitle: string | null;
  isPlatformAdmin: boolean;
  /** True when this user is the single owner of their company. */
  isCompanyOwner: boolean;
  companyId: string | null;
  lastLoginAt: string | null;
}

export interface Principal {
  user: UserSummary;
  company: CompanySummary | null;
  permissions: string[];
  /**
   * Whether this company still has to run the first-run wizard.
   *
   * Arrives with the session, so the first screen after login knows what to
   * render without a second request. `null` for platform staff, who belong to
   * no company and have nothing to onboard.
   */
  onboarding: { completed: boolean; skippedSteps: string[] } | null;
  /** Set only while a platform admin is impersonating this session. */
  impersonatedBy?: string | null;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
}

export interface AuthResult {
  tokens: AuthTokens;
  principal: Principal;
}

export interface SignupInput {
  /** The company is created from this name; there is no separate create step. */
  companyName: string;
  fullName: string;
  email: string;
  password: string;
  phoneNumber?: string | null;
  turnstileToken?: string;
}

export interface LoginInput {
  email: string;
  password: string;
  rememberMe?: boolean;
  turnstileToken?: string;
}

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

export const authApi = {
  /**
   * Registers a user and, implicitly, the company all of their data lives in.
   * The caller becomes that company's single owner.
   */
  async signup(input: SignupInput): Promise<AuthResult> {
    const result = await http.post<AuthResult>("/auth/signup", input);
    session.set(result.tokens.accessToken);
    return result;
  },

  async login(input: LoginInput): Promise<AuthResult> {
    const result = await http.post<AuthResult>("/auth/login", input);
    session.set(result.tokens.accessToken);
    return result;
  },

  /**
   * The current user, their company and their effective permissions.
   *
   * This is the authority for what the UI shows. Nothing should infer
   * permissions from a role *name* stored in localStorage — the backend
   * resolves them from the company's roles plus ownership, and a stale local
   * copy of that decision is how a revoked permission keeps working.
   */
  me(): Promise<Principal> {
    return http.get<Principal>("/auth/me");
  },

  async changePassword(input: ChangePasswordInput): Promise<AuthResult> {
    const result = await http.post<AuthResult>("/auth/change-password", input);
    // Rotating the password invalidates every session, including this one, so
    // the fresh pair replaces the old.
    session.set(result.tokens.accessToken);
    return result;
  },

  /** Revokes the current session, or every session for the user. */
  async logout(allSessions = false): Promise<void> {
    try {
      // The refresh token rides in the HttpOnly cookie; the backend revokes
      // the current cookie session, or every session for the user when
      // allSessions is set. skipRefresh: a 401 here means the session is
      // already gone, and refreshing it would defeat the logout.
      await request(
        "/auth/logout",
        { method: "POST", body: { allSessions }, skipRefresh: true },
      );
    } finally {
      session.clear();
      // The cache holds the previous account's principal, permissions and
      // onboarding state. Without this the next person to sign in on this
      // browser sees them until the page is reloaded — the bug this fixes.
      // `session.clear()` cannot do it itself: the transport module has no
      // access to the React Query client.
      announceSessionExpired();
    }
  },

  /** Pre-check: owner can self-reset; tenants are told to ask their owner. */
  async forgotPasswordCheck(email: string): Promise<{ accountKind: 'owner' | 'tenant' | 'unknown'; message: string }> {
    return http.post('/auth/forgot-password/check', { email });
  },

  /** Owner → emails a 24h reset link. Tenant/unknown → generic response. */
  async forgotPassword(email: string, turnstileToken?: string): Promise<{ tenant: boolean; message: string }> {
    return http.post('/auth/forgot-password', { email, turnstileToken });
  },

  /** Consumes the emailed token and sets the new password. */
  async resetPassword(token: string, newPassword: string): Promise<void> {
    await http.post('/auth/reset-password', { token, newPassword });
  },
};
