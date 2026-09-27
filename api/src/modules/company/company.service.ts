import { dbAdmin } from "../../config/database.js";
import { scoped, type AuthedRequest } from "../../shared/request.js";
import { audit } from "../../shared/audit.js";
import { toPage } from "../../shared/pagination.js";
import { NotFoundError } from "../../shared/errors.js";
import {
  companyRepository,
  platformCompanyAdmin,
  platformCompanyRepository,
} from "./company.repository.js";
import type {
  ListCompaniesInput,
  SetCompanyStatusInput,
  UpdateCompanyInput,
} from "./company.schemas.js";

/** Statuses that stop a company's members from reaching the API at all. */
const BLOCKING_STATUSES = new Set(["SUSPENDED", "CLOSED"]);

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: "نشطة",
  SUSPENDED: "معلقة",
  CLOSED: "مغلقة",
};

export const companyService = {
  /** The company the caller belongs to — the only company they can ever see. */
  async getProfile(req: AuthedRequest) {
    const companyId = requireCompany(req);
    return scoped(req, (tx) => companyRepository.findById(tx, companyId));
  },

  async updateProfile(req: AuthedRequest, input: UpdateCompanyInput) {
    const companyId = requireCompany(req);

    return scoped(req, async (tx) => {
      const updated = await companyRepository.update(tx, companyId, input);
      await audit(tx, {
        action: "company.updated",
        entity: "Company",
        entityId: updated.id,
        summary: "تم تحديث بيانات الشركة.",
        changes: input,
      });
      return updated;
    });
  },

  /** Platform back-office: every company on the installation. */
  async listAll(input: ListCompaniesInput) {
    const [items, total] = await platformCompanyRepository.list(input);
    return toPage(items, total, input);
  },

  /**
   * Takes a company out of service, or puts it back.
   *
   * Three things happen together or not at all: the status changes, the
   * company's live sessions end, and the change is written to the audit trail
   * with the reason. Splitting them across statements would allow a company to
   * be marked suspended while its staff keep working, or an unexplained
   * suspension with nothing to show the customer.
   *
   * Attributed to the acting platform administrator explicitly: they have no
   * company of their own, so there is no request context to inherit.
   */
  async setStatus(req: AuthedRequest, id: string, input: SetCompanyStatusInput) {
    return dbAdmin.$transaction(async (tx) => {
      const company = await platformCompanyAdmin.findForStatusChange(tx, id);
      if (!company) throw new NotFoundError("الشركة غير موجودة.");

      const updated = await tx.company.update({
        where: { id },
        data: {
          status: input.status,
          suspendedAt: input.status === "SUSPENDED" ? new Date() : null,
          suspensionReason: input.status === "SUSPENDED" ? (input.reason ?? null) : null,
          activatedAt: input.status === "ACTIVE" ? new Date() : undefined,
        },
        select: {
          id: true,
          name: true,
          slug: true,
          status: true,
          suspendedAt: true,
          suspensionReason: true,
        },
      });

      const revoked = BLOCKING_STATUSES.has(input.status)
        ? await platformCompanyAdmin.revokeSessions(tx, id)
        : 0;

      await audit(tx, {
        action: "company.statusChanged",
        entity: "Company",
        entityId: id,
        companyId: id,
        actorId: req.ctx.userId,
        summary: `تم تغيير حالة الشركة "${company.name}" من ${STATUS_LABELS[company.status] ?? company.status} إلى ${STATUS_LABELS[input.status] ?? input.status}.`,
        changes: {
          from: company.status,
          to: input.status,
          reason: input.reason ?? null,
          revokedSessions: revoked,
        },
      });

      return updated;
    });
  },
};

function requireCompany(req: AuthedRequest): string {
  if (!req.ctx.companyId) {
    throw new NotFoundError("هذا الحساب غير مرتبط بشركة.");
  }
  return req.ctx.companyId;
}
