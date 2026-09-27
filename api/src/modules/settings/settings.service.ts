import type { AuthedRequest } from "../../shared/request.js";
import { scoped } from "../../shared/request.js";
import { audit } from "../../shared/audit.js";
import { NotFoundError } from "../../shared/errors.js";
import { env } from "../../config/env.js";
import { settingsRepository } from "./settings.repository.js";
import type { UpdateSettingsInput } from "./settings.schemas.js";

export const settingsService = {
  async get(req: AuthedRequest) {
    return scoped(req, async (tx) => {
      const settings = await settingsRepository.get(tx, req.ctx.companyId!);
      if (!settings) throw new NotFoundError("إعدادات الشركة غير موجودة.");
      // shopifyEnabled is a DEPLOYMENT flag (env), not a stored column —
      // overlaid here so the UI reads one consistent shape.
      return { ...settings, shopifyEnabled: env.SHOPIFY_FEATURE_ENABLED };
    });
  },

  async update(req: AuthedRequest, input: UpdateSettingsInput) {
    return scoped(req, async (tx) => {
      const updated = await settingsRepository.update(tx, req.ctx.companyId!, input);
      await audit(tx, {
        action: "settings.updated",
        entity: "CompanySettings",
        entityId: updated.id,
        summary: "تم تحديث إعدادات الشركة.",
        changes: input,
      });
      return { ...updated, shopifyEnabled: env.SHOPIFY_FEATURE_ENABLED };
    });
  },
};
