import { z } from "zod";

/**
 * The onboarding steps, in the order the wizard shows them.
 *
 * Each slug is stable and stored: a skipped step is remembered by its slug, so
 * renaming one here silently orphans the stored value. Add new slugs at the end
 * and treat removal as a migration.
 *
 * The set is deliberately small. Every step here changes what the rest of the
 * app does with the company's data — nothing is a "welcome" screen that only
 * exists to look busy.
 */
export const ONBOARDING_STEPS = [
  /** What the business does — decides which modules are worth surfacing. */
  "business_type",
  /** Currency, timezone and VAT — every price and invoice depends on these. */
  "locale_finance",
  /** The first warehouse or store location stock is counted against. */
  "first_location",
  /** A first product, so the dashboard is not empty on arrival. */
  "first_product",
  /** Order numbering and confirmation behaviour. */
  "order_defaults",
] as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export const OnboardingStepSchema = z.enum(ONBOARDING_STEPS);

/** What kind of business this is. Drives which modules the UI highlights. */
export const BusinessTypeSchema = z.enum([
  "RETAIL", // بيع مباشر للعملاء
  "WHOLESALE", // بيع بالجملة
  "MANUFACTURING", // تصنيع
  "SERVICES", // خدمات
  "ECOMMERCE", // تجارة إلكترونية
  "OTHER",
]);

export type BusinessType = z.infer<typeof BusinessTypeSchema>;

/**
 * Every field is optional and the whole body may be empty.
 *
 * Onboarding must never be able to fail on validation: a user who skips
 * everything, or submits a step partially filled, should still be able to move
 * on. The wizard is a convenience, not a gate — so "required" fields are
 * enforced by the UI, where the user can be told what is missing, rather than
 * by a 422 that strands them mid-flow.
 */
export const CompleteOnboardingSchema = z
  .object({
    /** Steps the user explicitly skipped, recorded so the UI can revisit them. */
    skippedSteps: z.array(OnboardingStepSchema).default([]),

    // ---- business_type ----
    businessType: BusinessTypeSchema.optional(),

    // ---- locale_finance ----
    currencyCode: z.string().trim().length(3).toUpperCase().optional(),
    timeZone: z.string().trim().min(1).max(64).optional(),
    fiscalYearStartMonth: z.coerce.number().int().min(1).max(12).optional(),
    defaultSalesVatRate: z.coerce.number().min(0).max(100).optional(),
    defaultPurchaseVatRate: z.coerce.number().min(0).max(100).optional(),

    // ---- first_location ----
    // A name for the initial warehouse. Omitted = keep the provisioned one.
    warehouseName: z.string().trim().min(1).max(200).optional(),

    // ---- order_defaults ----
    orderPrefix: z.string().trim().min(1).max(20).optional(),
    requireOrderConfirmation: z.boolean().optional(),
    defaultOrderValidityHours: z.coerce.number().int().min(1).max(8760).optional(),
  })
  .strict();

export type CompleteOnboardingInput = z.infer<typeof CompleteOnboardingSchema>;

/**
 * The status the app checks on load.
 *
 * `steps` is returned alongside `completed` because the client needs to know
 * which steps exist to render progress — sending only a boolean would force the
 * frontend to keep its own copy of the list, and the two would drift.
 */
export interface OnboardingStatus {
  completed: boolean;
  completedAt: string | null;
  skippedSteps: string[];
  steps: readonly string[];
}
