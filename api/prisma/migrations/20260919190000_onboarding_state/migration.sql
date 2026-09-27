-- Onboarding state, stored on the company's settings row.
--
-- A company is created fully provisioned (roles, settings, a warehouse, the
-- standard operation types), so onboarding is not about creating prerequisites
-- — it is about the handful of decisions only the owner can make: what the
-- business does, what it sells, how it ships. Those answers land in the
-- existing settings columns; this migration only records whether the wizard
-- has been dealt with.
--
-- "completedAt" is a timestamp rather than a boolean so the answer is "when"
-- as well as "whether", and so a future re-onboarding can be told apart from
-- the first run.
--
-- "skippedSteps" records which steps were passed over. Skipping is a
-- first-class outcome, not a failure: a user who wants to look around before
-- committing should not be nagged, but knowing WHAT they skipped lets the UI
-- prompt for the relevant thing later instead of asking again blindly.
--
-- DEFAULT '{}' is required, not cosmetic: existing rows get the empty array
-- rather than NULL, so the API never has to handle a null list and the
-- "have they skipped anything?" check is a plain length test.
ALTER TABLE "company_settings"
  ADD COLUMN "onboardingCompletedAt" TIMESTAMP(3),
  ADD COLUMN "onboardingSkippedSteps" TEXT[] NOT NULL DEFAULT '{}';
