import type { Db } from "../../config/database.js";
import type { UpdateSettingsInput } from "./settings.schemas.js";

// Settings are a single row per company, created when the company is
// provisioned. `findOrCreate` only as a safety net: if a company predates the
// settings row, the UI should still load rather than throw.
export const settingsRepository = {
  get(tx: Db, companyId: string) {
    // The comment above promises a safety net: a company provisioned before
    // the settings feature has no row, and a bare findUnique turned that into
    // a 404 on every settings page load. Upsert on read so the row always
    // exists; creation needs no input because every column has a default.
    return tx.companySettings.upsert({
      where: { companyId },
      create: { companyId },
      update: {},
    });
  },

  update(tx: Db, companyId: string, data: UpdateSettingsInput) {
    return tx.companySettings.upsert({
      where: { companyId },
      create: { companyId, ...data },
      update: data,
    });
  },
};
