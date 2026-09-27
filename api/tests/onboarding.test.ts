import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";

import { dbAdmin } from "../src/config/database.js";
import { api, startServer, stopServer } from "./helpers/server.js";
import { stopMetricsPush } from "../src/observability/metrics.js";
import { createCompany, cleanupFixtures, type FixtureCompany } from "./helpers/fixtures.js";
import { tokenFor } from "./helpers/principal.js";

// First-run setup.
//
// These run against the real API and a real company, because the whole point of
// onboarding is what it writes — a mocked repository would pass whether or not
// the columns were correct, which is exactly the bug an earlier draft had
// (currency written to a settings column that does not exist).
//
// The two rules worth protecting:
//   1. A new company is NOT onboarded, and its owner IS told so on /auth/me.
//      If the flag were missing, every existing company would be shown the
//      wizard again.
//   2. Skipping is a first-class outcome. A user who skips everything must
//      reach `completed: true` — otherwise the wizard is a wall, not a shortcut.

let alpha: FixtureCompany;
let ownerToken = "";

before(async () => {
  alpha = await createCompany("onb");
  ownerToken = await tokenFor(alpha.ownerId);
  await startServer();
});

after(async () => {
  await stopServer();
  await cleanupFixtures();
  stopMetricsPush();
});

describe("onboarding status", () => {
  test("a fresh company reports not completed", async () => {
    const res = await api<{ completed: boolean; steps: string[] }>({
      path: "/api/v1/onboarding",
      token: ownerToken,
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.data!.completed, false, "a newly provisioned company has not been onboarded");
    assert.ok(res.body.data!.steps.length > 0, "the server must send the step list, so the two cannot drift");
  });

  test("/auth/me carries the flag, so login needs no extra request", async () => {
    const res = await api<{ onboarding: { completed: boolean; skippedSteps: string[] } | null }>({
      path: "/api/v1/auth/me",
      token: ownerToken,
    });
    assert.equal(res.status, 200);
    assert.ok(res.body.data!.onboarding, "the principal must include onboarding state");
    assert.equal(res.body.data!.onboarding!.completed, false);
    assert.deepEqual(res.body.data!.onboarding!.skippedSteps, []);
  });
});

describe("completing onboarding", () => {
  test("records the answers and marks the company done", async () => {
    const res = await api<{ completed: boolean }>({
      path: "/api/v1/onboarding/complete",
      method: "POST",
      token: ownerToken,
      body: {
        skippedSteps: ["first_product"],
        businessType: "RETAIL",
        currencyCode: "SAR",
        timeZone: "Asia/Riyadh",
        fiscalYearStartMonth: 7,
        defaultSalesVatRate: 15,
        warehouseName: "مخزن الرياض",
        orderPrefix: "SO",
        requireOrderConfirmation: false,
      },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.data!.completed, true);

    // Currency and timezone are COMPANY columns; the rest are settings.
    const company = await dbAdmin.company.findUniqueOrThrow({
      where: { id: alpha.companyId },
      select: { currencyCode: true, timeZone: true },
    });
    assert.equal(company.currencyCode, "SAR");
    assert.equal(company.timeZone, "Asia/Riyadh");

    const settings = await dbAdmin.companySettings.findUniqueOrThrow({
      where: { companyId: alpha.companyId },
      select: {
        fiscalYearStartMonth: true,
        onboardingCompletedAt: true,
        onboardingSkippedSteps: true,
        orderPrefix: true,
        requireOrderConfirmation: true,
      },
    });
    assert.equal(settings.fiscalYearStartMonth, 7);
    assert.equal(settings.orderPrefix, "SO");
    assert.equal(settings.requireOrderConfirmation, false);
    assert.ok(settings.onboardingCompletedAt, "completion must be timestamped");
    assert.deepEqual(settings.onboardingSkippedSteps, ["first_product"]);
  });

  test("the warehouse is renamed, not duplicated", async () => {
    // Provisioning already creates one. A second, empty warehouse named by
    // nobody would be worse than a well-named single one.
    const warehouses = await dbAdmin.warehouse.findMany({
      where: { companyId: alpha.companyId, deletedAt: null },
      select: { name: true },
    });
    assert.equal(warehouses.length, 1, "onboarding must not add a warehouse");
    assert.equal(warehouses[0]!.name, "مخزن الرياض");
  });

  test("status now reports completed", async () => {
    const res = await api<{ completed: boolean; completedAt: string | null }>({
      path: "/api/v1/onboarding",
      token: ownerToken,
    });
    assert.equal(res.body.data!.completed, true);
    assert.ok(res.body.data!.completedAt, "the completion time is reported");
  });

  test("completing again is idempotent", async () => {
    const res = await api<{ completed: boolean }>({
      path: "/api/v1/onboarding/complete",
      method: "POST",
      token: ownerToken,
      body: { skippedSteps: [] },
    });
    assert.equal(res.status, 200, "a second call must not fail");
    assert.equal(res.body.data!.completed, true);
  });
});

describe("skipping everything", () => {
  test("an empty body still completes onboarding", async () => {
    // This is the rule that keeps the wizard from being a wall: a user who
    // wants to look around first must be able to get past it.
    const beta = await createCompany("onb2");
    const betaToken = await tokenFor(beta.ownerId);

    const res = await api<{ completed: boolean; skippedSteps: string[] }>({
      path: "/api/v1/onboarding/complete",
      method: "POST",
      token: betaToken,
      body: {},
    });

    assert.equal(res.status, 200, "an empty body is valid");
    assert.equal(res.body.data!.completed, true);
    assert.deepEqual(res.body.data!.skippedSteps, []);
  });
});
