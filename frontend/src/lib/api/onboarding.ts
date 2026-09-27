import { http } from "./http";

// First-run setup.
//
// The wizard's answers go to `/onboarding/complete`, which writes the same
// company and settings columns the settings screen owns — this is a guided
// route to them, not a parallel store. That is deliberate: a second place
// holding "the real currency" would eventually disagree with the first.
//
// Every field is optional and the body may be empty. Onboarding must never
// fail on validation: a user who skips everything has to be able to finish,
// or the wizard becomes a wall instead of a shortcut.

export const ONBOARDING_STEPS = [
  "business_type",
  "locale_finance",
  "first_location",
  "first_product",
  "order_defaults",
] as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export type BusinessType = "RETAIL" | "WHOLESALE" | "MANUFACTURING" | "SERVICES" | "ECOMMERCE" | "OTHER";

export interface OnboardingStatus {
  completed: boolean;
  completedAt: string | null;
  skippedSteps: string[];
  /** The server's list of steps, so the two cannot drift apart. */
  steps: string[];
}

export interface CompleteOnboardingInput {
  skippedSteps?: OnboardingStep[];

  businessType?: BusinessType;

  currencyCode?: string;
  timeZone?: string;
  fiscalYearStartMonth?: number;
  defaultSalesVatRate?: number;
  defaultPurchaseVatRate?: number;

  warehouseName?: string;

  orderPrefix?: string;
  requireOrderConfirmation?: boolean;
  defaultOrderValidityHours?: number;
}

export const onboardingApi = {
  /** Whether this company still needs the wizard. */
  status: (): Promise<OnboardingStatus> => http.get<OnboardingStatus>("/onboarding"),

  /**
   * Applies the answers and marks onboarding done.
   *
   * Called even when the user skipped everything — `skippedSteps` records what
   * was passed over so the app can prompt for it later instead of asking again.
   */
  complete: (input: CompleteOnboardingInput): Promise<OnboardingStatus> =>
    http.post<OnboardingStatus>("/onboarding/complete", input),
};
