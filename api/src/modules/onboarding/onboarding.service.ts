import type { AuthedRequest } from "../../shared/request.js";
import { scoped } from "../../shared/request.js";
import { audit } from "../../shared/audit.js";
import type { CompleteOnboardingInput, OnboardingStatus } from "./onboarding.schemas.js";
import { ONBOARDING_STEPS } from "./onboarding.schemas.js";

export const onboardingService = {
  /**
   * Whether this company still needs to run the wizard.
   *
   * Reads the settings row through `upsert`, the same way the settings endpoint
   * does: a company provisioned before this feature has no row, and a missing
   * row must read as "not onboarded" rather than 404 — the app calls this on
   * every load, and a 404 there would be a broken first screen for exactly the
   * users who most need the wizard.
   */
  async status(req: AuthedRequest): Promise<OnboardingStatus> {
    return scoped(req, async (tx) => {
      const settings = await tx.companySettings.upsert({
        where: { companyId: req.ctx.companyId! },
        create: { companyId: req.ctx.companyId! },
        update: {},
        select: { onboardingCompletedAt: true, onboardingSkippedSteps: true },
      });

      return {
        completed: settings.onboardingCompletedAt !== null,
        completedAt: settings.onboardingCompletedAt?.toISOString() ?? null,
        skippedSteps: settings.onboardingSkippedSteps,
        steps: ONBOARDING_STEPS,
      };
    });
  },

  /**
   * Applies whatever the wizard collected and marks onboarding done.
   *
   * Completion is recorded even when every step was skipped. That is the point
   * of `skippedSteps`: the user is not asked again, but the app knows what is
   * missing and can prompt for it in context later. Recording nothing would
   * mean re-showing the wizard forever, which is how onboarding becomes
   * something people learn to click past.
   *
   * Every write is conditional on the field being present, so a partially
   * filled step updates only what was answered and leaves the provisioned
   * defaults for the rest.
   */
  async complete(req: AuthedRequest, input: CompleteOnboardingInput) {
    return scoped(req, async (tx) => {
      const companyId = req.ctx.companyId!;

      // ---- settings columns the wizard may set ----
      // currencyCode and timeZone are NOT settings columns — they live on
      // Company and are written in their own block below. Passing them here
      // would be a Prisma validation error, which is how this was caught.
      const settingsData = {
        ...(input.fiscalYearStartMonth !== undefined
          ? { fiscalYearStartMonth: input.fiscalYearStartMonth }
          : {}),
        ...(input.defaultSalesVatRate !== undefined
          ? { defaultSalesVatRate: input.defaultSalesVatRate }
          : {}),
        ...(input.defaultPurchaseVatRate !== undefined
          ? { defaultPurchaseVatRate: input.defaultPurchaseVatRate }
          : {}),
        ...(input.orderPrefix ? { orderPrefix: input.orderPrefix } : {}),
        ...(input.requireOrderConfirmation !== undefined
          ? { requireOrderConfirmation: input.requireOrderConfirmation }
          : {}),
        ...(input.defaultOrderValidityHours !== undefined
          ? { defaultOrderValidityHours: input.defaultOrderValidityHours }
          : {}),
        onboardingCompletedAt: new Date(),
        onboardingSkippedSteps: input.skippedSteps,
      };

      // `companyId` is deliberately absent from `create`: the column has a
      // database default of current_setting('app.company_id'), which is set by
      // the surrounding transaction. Passing it explicitly is rejected by
      // Prisma's generated types. This mirrors settings.repository.update.
      const settings = await tx.companySettings.upsert({
        where: { companyId },
        create: settingsData,
        update: settingsData,
      });

      // ---- company columns the wizard may set ----
      // Currency and timezone are Company columns (identity.prisma). The
      // settings table has no such columns — an earlier draft assumed it did
      // and the database rejected it.
      if (input.currencyCode || input.timeZone) {
        await tx.company.update({
          where: { id: companyId },
          data: {
            ...(input.currencyCode ? { currencyCode: input.currencyCode } : {}),
            ...(input.timeZone ? { timeZone: input.timeZone } : {}),
          },
        });
      }

      // ---- first_location ----
      // Renames the warehouse provisioning already created rather than adding a
      // second one. A new company with two warehouses, one of them empty and
      // unnamed by the user, is worse than one with a good name.
      if (input.warehouseName) {
        const existing = await tx.warehouse.findFirst({
          where: { companyId, deletedAt: null },
          orderBy: { createdAt: "asc" },
          select: { id: true },
        });
        if (existing) {
          await tx.warehouse.update({
            where: { id: existing.id },
            data: { name: input.warehouseName },
          });
        } else {
          // Provisioning was skipped or the warehouse was deleted; create one
          // so the wizard's promise ("you have a location") is actually true.
          await tx.warehouse.create({
            data: { companyId, name: input.warehouseName, code: "MAIN", isDefault: true, isActive: true },
          });
        }
      }

      await audit(tx, {
        action: "onboarding.completed",
        entity: "CompanySettings",
        entityId: settings.id,
        summary:
          input.skippedSteps.length > 0
            ? `تم إكمال التهيئة مع تخطي ${input.skippedSteps.length} خطوة.`
            : "تم إكمال تهيئة الشركة.",
        changes: { skippedSteps: input.skippedSteps, ...settingsData },
      });

      return {
        completed: true,
        completedAt: settings.onboardingCompletedAt?.toISOString() ?? null,
        skippedSteps: settings.onboardingSkippedSteps,
        steps: ONBOARDING_STEPS,
      } satisfies OnboardingStatus;
    });
  },
};
