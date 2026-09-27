import { Router } from "express";
import { z } from "zod";
import type { Db } from "../../config/database.js";
import { parsePagination, toPage } from "../../shared/pagination.js";
import { orderBy, pageSlice, searchFilter } from "../../shared/query.js";
import { scoped, type AuthedRequest } from "../../shared/request.js";
import { route } from "../../shared/route.js";

// Countries are global reference data, not company data: every tenant sees the
// same list and none of them may edit it. That is why this route has no
// permission gate and no write routes — it is a lookup table used to fill
// address forms.

export const CountryFilterSchema = z.object({
  isActive: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),
});

const SELECT = {
  id: true,
  code: true,
  nameEn: true,
  nameAr: true,
  phoneCode: true,
  currencyCode: true,
  isActive: true,
} as const;

const router = Router();
router.get(
  "/",
  route(async (req: AuthedRequest) => {
    const input = parsePagination(req.query);
    const filter = CountryFilterSchema.parse(req.query);

    return scoped(req, async (tx: Db) => {
      const where = {
        ...(filter.isActive === undefined ? {} : { isActive: filter.isActive }),
        ...searchFilter(["code", "nameEn", "nameAr"], input.search),
      };

      // Sequential: `tx` is ONE connection — racing statements on it is not parallel.
      const items = await tx.country.findMany({
        where,
        orderBy: orderBy(input, ["code", "nameEn", "nameAr"], "nameEn"),
        ...pageSlice(input),
        select: SELECT,
      });
      const total = await tx.country.count({ where });
      return toPage(items, total, input);
    });
  })
);

export { router as countryRoutes };
