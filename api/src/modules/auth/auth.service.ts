import type { Db } from "../../config/database.js";
import { dbAdmin } from "../../config/database.js";
import { env } from "../../config/env.js";
import { getAllPermissions } from "../../constants/permissions.js";
import {
  ConflictError,
  ForbiddenError,
  UnauthorizedError,
} from "../../shared/errors.js";
import { comparePassword, hashPassword } from "../../utils/password.js";
import { signAccessToken } from "../../utils/jwt.js";
import { slugifyOrFallback } from "../../utils/slug.js";
import { generateOpaqueToken, hashToken, newSecurityStamp } from "../../utils/tokens.js";
import { provisionCompany } from "../company/company.defaults.js";
import type { ChangePasswordInput, LoginInput, SignupInput } from "./auth.schemas.js";
import { assertHuman } from "./turnstile.js";
import { authLimitKey, clearLimit } from "../../lib/rateLimit.js";
import { observeAuthEvent } from "../../observability/metrics.js";

// ---------------------------------------------------------------------------
// Shapes returned to the client
// ---------------------------------------------------------------------------

export interface CompanySummary {
  id: string;
  name: string;
  slug: string;
  status: string;
}

export interface UserSummary {
  id: string;
  email: string;
  fullName: string;
  phoneNumber: string | null;
  avatarUrl: string | null;
  jobTitle: string | null;
  isPlatformAdmin: boolean;
  isCompanyOwner: boolean;
  companyId: string | null;
  lastLoginAt: Date | null;
}

export interface Principal {
  user: UserSummary;
  company: CompanySummary | null;
  permissions: string[];
  /**
   * Whether this company still has to run the first-run wizard.
   *
   * Delivered with the session rather than fetched separately: the client
   * decides what to render on the very first screen after login, and a second
   * request there would show the dashboard for a beat before redirecting.
   *
   * `null` for a platform admin with no company — there is nothing to onboard.
   */
  onboarding: { completed: boolean; skippedSteps: string[] } | null;
  /** Set only while a platform admin is impersonating this session. */
  impersonatedBy: string | null;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: Date;
  refreshTokenExpiresAt: Date;
}

export interface AuthResult {
  tokens: AuthTokens;
  principal: Principal;
}

// ---------------------------------------------------------------------------
// Permission resolution
// ---------------------------------------------------------------------------

const PRINCIPAL_SELECT = {
  id: true,
  email: true,
  fullName: true,
  phoneNumber: true,
  avatarUrl: true,
  jobTitle: true,
  isPlatformAdmin: true,
  companyId: true,
  lastLoginAt: true,
  company: {
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      ownerId: true,
      // Onboarding state rides along with the company the principal already
      // loads, so login and /auth/me can tell the client whether to open the
      // wizard without a second round-trip to /onboarding.
      settings: { select: { onboardingCompletedAt: true, onboardingSkippedSteps: true } },
    },
  },
  roles: { select: { role: { select: { permissions: { select: { permissionKey: true } } } } } },
} as const;

type PrincipalRow = {
  id: string;
  email: string;
  fullName: string;
  phoneNumber: string | null;
  avatarUrl: string | null;
  jobTitle: string | null;
  isPlatformAdmin: boolean;
  companyId: string | null;
  lastLoginAt: Date | null;
  company: {
    id: string;
    name: string;
    slug: string;
    status: string;
    ownerId: string;
    settings: { onboardingCompletedAt: Date | null; onboardingSkippedSteps: string[] } | null;
  } | null;
  roles: { role: { permissions: { permissionKey: string }[] } }[];
};

/**
 * Owners and platform staff hold every permission implicitly; everyone else
 * gets the union of their roles.
 *
 * This is recomputed on each login and refresh rather than baked into the
 * token, so a revoked role stops working immediately.
 */
function resolvePermissions(row: PrincipalRow): string[] {
  const isCompanyOwner = row.company ? row.company.ownerId === row.id : false;
  if (isCompanyOwner || row.isPlatformAdmin) return getAllPermissions();
  return [...new Set(row.roles.flatMap((ur) => ur.role.permissions.map((p) => p.permissionKey)))];
}

/**
 * Builds the client-facing Principal from a user row.
 *
 * Exported so `authenticate` can hand the row it already loaded to /auth/me
 * through `req.principalRow`, sparing the endpoint a second identical load of
 * the user, company, roles and permissions.
 */
export function toPrincipal(row: PrincipalRow, impersonatedBy: string | null = null): Principal {
  const isCompanyOwner = row.company ? row.company.ownerId === row.id : false;
  return {
    user: {
      id: row.id,
      email: row.email,
      fullName: row.fullName,
      phoneNumber: row.phoneNumber,
      avatarUrl: row.avatarUrl,
      jobTitle: row.jobTitle,
      isPlatformAdmin: row.isPlatformAdmin,
      isCompanyOwner,
      companyId: row.companyId,
      lastLoginAt: row.lastLoginAt,
    },
    company: row.company
      ? {
          id: row.company.id,
          name: row.company.name,
          slug: row.company.slug,
          status: row.company.status,
        }
      : null,
    permissions: resolvePermissions(row),
    onboarding: row.company
      ? {
          completed: row.company.settings?.onboardingCompletedAt != null,
          skippedSteps: row.company.settings?.onboardingSkippedSteps ?? [],
        }
      : null,
    impersonatedBy,
  };
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

function refreshExpiry(rememberMe: boolean): Date {
  const minutes = rememberMe ? env.JWT_REFRESH_REMEMBER_MINUTES : env.JWT_REFRESH_MINUTES;
  return new Date(Date.now() + minutes * 60_000);
}

/**
 * Creates a session row and issues the token pair.
 *
 * Only the digest of the refresh token is persisted — a leaked sessions table
 * is not a usable credential.
 */
export async function issueSession(
  tx: Db,
  userId: string,
  opts: { userAgent?: string | null; ipAddress?: string | null; rememberMe?: boolean; impersonatedBy?: string | null } = {}
): Promise<AuthTokens> {
  const row = await tx.user.findUniqueOrThrow({
    where: { id: userId },
    select: { id: true, email: true, securityStamp: true, companyId: true, isPlatformAdmin: true },
  });

  const refreshToken = generateOpaqueToken();
  const expiresAt = refreshExpiry(opts.rememberMe ?? false);

  const session = await tx.session.create({
    data: {
      userId,
      refreshToken: hashToken(refreshToken),
      expiresAt,
      userAgent: opts.userAgent?.slice(0, 500) ?? null,
      ipAddress: opts.ipAddress ?? null,
      impersonatedBy: opts.impersonatedBy?.slice(0, 200) ?? null,
    },
    select: { id: true },
  });

  const { token: accessToken, expiresAt: accessTokenExpiresAt } = signAccessToken({
    sub: row.id,
    sid: session.id,
    email: row.email,
    securityStamp: row.securityStamp ?? "",
    companyId: row.companyId,
    isPlatformAdmin: row.isPlatformAdmin,
  });

  return {
    accessToken,
    refreshToken,
    accessTokenExpiresAt,
    refreshTokenExpiresAt: expiresAt,
  };
}

// ---------------------------------------------------------------------------
// Signup — where the company is created without the user being told about it
// ---------------------------------------------------------------------------

async function uniqueSlug(name: string): Promise<string> {
  const base = slugifyOrFallback(name);

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const taken = await dbAdmin.company.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });
    if (!taken) return candidate;
  }

  // Fifty collisions on the same name means something is generating them in a
  // loop; fall back to a random suffix rather than failing the signup.
  return `${base}-${generateOpaqueToken(6).toLowerCase()}`;
}

/**
 * Registers a user and, transparently, the company all of their data will live
 * in.
 *
 * The user is not asked to "create a company": they give a name, and that name
 * becomes the company. The user is then that company's single owner, which the
 * database enforces through `Company.ownerId @unique ... onDelete: Restrict` —
 * the owner row cannot be deleted while the company exists.
 *
 * Order matters because of the circular reference: the user is created first
 * with no company, the company then points its `ownerId` at that user, and
 * finally the user is attached to the company.
 */
export async function signup(
  input: SignupInput,
  meta: { userAgent?: string; ipAddress?: string } = {}
): Promise<AuthResult> {
  const email = input.email.toLowerCase();

  await assertHuman(input.turnstileToken, meta.ipAddress);

  const existing = await dbAdmin.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    throw new ConflictError("هذا البريد الإلكتروني مسجل بالفعل.");
  }

  const passwordHash = await hashPassword(input.password);
  const slug = await uniqueSlug(input.companyName);

  const { userId, tokens } = await dbAdmin.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email,
        passwordHash,
        fullName: input.fullName,
        phoneNumber: input.phoneNumber ?? null,
        status: "ACTIVE",
        securityStamp: newSecurityStamp(),
      },
      select: { id: true },
    });

    const company = await tx.company.create({
      data: {
        name: input.companyName,
        slug,
        status: "ACTIVE",
        // The one and only super admin.
        ownerId: user.id,
      },
      select: { id: true },
    });

    await tx.user.update({
      where: { id: user.id },
      data: { companyId: company.id, lastLoginAt: new Date() },
    });

    await provisionCompany(tx, {
      companyId: company.id,
      ownerUserId: user.id,
      companyName: input.companyName,
    });

    await tx.auditLog.create({
      data: {
        companyId: company.id,
        actorId: user.id,
        action: "company.created",
        entity: "Company",
        entityId: company.id,
        summary: `تم إنشاء شركة "${input.companyName}" وتعيين المالك.`,
        ipAddress: meta.ipAddress ?? null,
      },
    });

    const issued = await issueSession(tx, user.id, meta);
    return { userId: user.id, tokens: issued };
  });

  const principal = await loadPrincipal(userId);
  // Success wipes the brute-force count (replaces skipSuccessfulRequests).
  await clearLimit(authLimitKey(meta.ipAddress, input.email));
  observeAuthEvent("signup");
  return { tokens, principal };
}

// ---------------------------------------------------------------------------
// Login / refresh / logout
// ---------------------------------------------------------------------------

export async function login(
  input: LoginInput,
  meta: { userAgent?: string; ipAddress?: string } = {}
): Promise<AuthResult> {
  const email = input.email.toLowerCase();

  await assertHuman(input.turnstileToken, meta.ipAddress);

  // Privileged lookup: no company is known yet, so row-level security would
  // block the very query that finds out which company to use.
  const user = await dbAdmin.user.findUnique({
    where: { email },
    select: {
      id: true,
      passwordHash: true,
      status: true,
      deletedAt: true,
      company: { select: { status: true } },
    },
  });

  const invalid = new UnauthorizedError("البريد الإلكتروني أو كلمة المرور غير صحيحة.");

  if (!user || user.deletedAt || !user.passwordHash) {
    observeAuthEvent("login_failed");
    throw invalid;
  }

  const passwordOk = await comparePassword(input.password, user.passwordHash);
  if (!passwordOk) {
    observeAuthEvent("login_failed");
    throw invalid;
  }

  if (user.status !== "ACTIVE") {
    throw new ForbiddenError("هذا الحساب معطل حالياً، يرجى التواصل مع الدعم.");
  }

  if (user.company?.status === "SUSPENDED") {
    throw new ForbiddenError("تم تعليق الشركة، يرجى التواصل مع الدعم.");
  }

  const tokens = await dbAdmin.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    return issueSession(tx, user.id, { ...meta, rememberMe: input.rememberMe });
  });

  const principal = await loadPrincipal(user.id);
  // Success wipes the brute-force count (replaces skipSuccessfulRequests).
  await clearLimit(authLimitKey(meta.ipAddress, email));
  observeAuthEvent("login");
  return { tokens, principal };
}

/**
 * Rotates a refresh token.
 *
 * Rotation means a refresh token is single use: presenting it creates a
 * successor and marks the old row revoked. If a revoked token is presented
 * again — a stolen token being replayed — we treat the whole session family as
 * compromised and revoke everything for that user.
 */
export async function refresh(
  refreshToken: string,
  meta: { userAgent?: string; ipAddress?: string } = {}
): Promise<AuthResult> {
  const tokenHash = hashToken(refreshToken);

  const session = await dbAdmin.session.findUnique({
    where: { refreshToken: tokenHash },
    select: {
      id: true,
      userId: true,
      expiresAt: true,
      revokedAt: true,
      impersonatedBy: true,
      user: { select: { id: true, status: true, deletedAt: true } },
    },
  });

  if (!session) throw new UnauthorizedError("جلسة غير صالحة، يرجى تسجيل الدخول مرة أخرى.");

  // Replay. Someone is using a token that has already been exchanged.
  if (session.revokedAt) {
    await revokeAllSessions(session.userId);
    // A replay is the signal the stolen-token path fired; count it as a failure
    // so the auth-failure alert covers it, not just bad passwords.
    observeAuthEvent("login_failed");
    throw new UnauthorizedError("تم اكتشاف استخدام مكرر للجلسة، يرجى تسجيل الدخول مرة أخرى.");
  }

  if (session.expiresAt.getTime() <= Date.now()) {
    await dbAdmin.session.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });
    throw new UnauthorizedError("انتهت صلاحية الجلسة، يرجى تسجيل الدخول مرة أخرى.");
  }

  if (!session.user || session.user.deletedAt || session.user.status !== "ACTIVE") {
    throw new UnauthorizedError("انتهت صلاحية الجلسة، يرجى تسجيل الدخول مرة أخرى.");
  }

  const tokens = await dbAdmin.$transaction(async (tx) => {
    // Impersonation survives rotation: the successor session keeps announcing
    // the acting platform admin, so the banner never silently drops mid-run.
    const issued = await issueSession(tx, session.userId, {
      ...meta,
      impersonatedBy: session.impersonatedBy,
    });

    const newSession = await tx.session.findUniqueOrThrow({
      where: { refreshToken: hashToken(issued.refreshToken) },
      select: { id: true },
    });

    await tx.session.update({
      where: { id: session.id },
      data: { revokedAt: new Date(), replacedById: newSession.id },
    });

    return issued;
  });

  const principal = await loadPrincipal(session.userId);
  // An impersonated session is reported separately so a platform admin's
  // rotation is never mistaken for a normal user refresh.
  observeAuthEvent(session.impersonatedBy ? "impersonation" : "refresh");
  return { tokens, principal };
}

/** Revokes one session, or every session for the user when no token is given. */
export async function logout(refreshToken?: string, userId?: string): Promise<void> {
  if (refreshToken) {
    const { count } = await dbAdmin.session.updateMany({
      where: { refreshToken: hashToken(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (count > 0) observeAuthEvent("logout");
    return;
  }

  if (userId) {
    await revokeAllSessions(userId);
    observeAuthEvent("logout");
  }
}

export async function revokeAllSessions(userId: string): Promise<void> {
  await dbAdmin.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function changePassword(
  userId: string,
  input: ChangePasswordInput,
  meta: { userAgent?: string; ipAddress?: string } = {}
): Promise<AuthResult> {
  const user = await dbAdmin.user.findUnique({
    where: { id: userId },
    select: { id: true, passwordHash: true },
  });

  if (!user?.passwordHash) throw new UnauthorizedError("لم يتم تسجيل الدخول.");

  const okCurrent = await comparePassword(input.currentPassword, user.passwordHash);
  if (!okCurrent) throw new UnauthorizedError("كلمة المرور الحالية غير صحيحة.");

  // Rotating the stamp invalidates every access token already issued, so all
  // sessions go and a fresh pair comes back for the current one.
  const passwordHash = await hashPassword(input.newPassword);

  const tokens = await dbAdmin.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { passwordHash, securityStamp: newSecurityStamp() },
    });
    await tx.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return issueSession(tx, userId, meta);
  });

  const principal = await loadPrincipal(userId);
  return { tokens, principal };
}

// ---------------------------------------------------------------------------
// Current user
// ---------------------------------------------------------------------------

export async function loadPrincipal(userId: string, sessionId?: string): Promise<Principal> {
  const row = await dbAdmin.user.findUniqueOrThrow({
    where: { id: userId },
    select: PRINCIPAL_SELECT,
  });
  // When the caller knows the current session (JWT sid), report whether that
  // session is an impersonation and by whom — /auth/me banners it in the app.
  const impersonatedBy = sessionId ? await loadImpersonatedBy(sessionId) : null;
  return toPrincipal(row as PrincipalRow, impersonatedBy);
}

/**
 * Whether a session is an impersonation, and by whom.
 *
 * Split out so /auth/me can read it without reloading the user: the row it
 * already has covers everything except this one session-scoped field, so the
 * endpoint pays 1 round-trip instead of 6.
 */
export async function loadImpersonatedBy(sessionId: string): Promise<string | null> {
  const session = await dbAdmin.session.findUnique({
    where: { id: sessionId },
    select: { impersonatedBy: true },
  });
  return session?.impersonatedBy ?? null;
}
