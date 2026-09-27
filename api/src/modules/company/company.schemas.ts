import { z } from "zod";
import { env } from "../../config/env.js";

const shortText = (max: number) => z.string().trim().max(max);

export const UpdateCompanySchema = z
  .object({
    name: z.string().trim().min(2, "اسم الشركة قصير جداً.").max(200).optional(),

    legalName: shortText(200).nullish(),
    taxNumber: shortText(60).nullish(),
    commercialNo: shortText(60).nullish(),

    email: z.string().trim().toLowerCase().email("بريد إلكتروني غير صالح.").max(200).nullish(),
    phoneNumber: shortText(50).nullish(),
    website: shortText(300).nullish(),

    addressLine: shortText(300).nullish(),
    city: shortText(120).nullish(),
    region: shortText(120).nullish(),
    countryCode: z
      .string()
      .trim()
      .length(2, "كود الدولة يجب أن يكون حرفين.")
      .nullish(),
    postalCode: shortText(20).nullish(),

    currencyCode: z.string().trim().length(3, "كود العملة يجب أن يكون ٣ أحرف.").optional(),
    timeZone: shortText(64).optional(),
    locale: shortText(12).optional(),
    fiscalYearStartMonth: z.coerce.number().int().min(1).max(12).optional(),
  })
  .strict();

export const ListCompaniesSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(env.PAGINATION_MAX_PAGE_SIZE).default(10),
  search: z.string().trim().optional(),
  status: z.enum(["ACTIVE", "SUSPENDED", "CLOSED"]).optional(),
});

/**
 * Taking a company out of service is the heaviest thing the platform can do to
 * a customer, so the reason is part of the contract rather than a free-text
 * nicety. It is written to the company row and to the audit trail, so the
 * person who calls support can be told why.
 */
export const SetCompanyStatusSchema = z
  .object({
    status: z.enum(["ACTIVE", "SUSPENDED", "CLOSED"]),
    reason: z.string().trim().max(500).optional(),
  })
  .refine(
    (value) => (value.status === "SUSPENDED" || value.status === "CLOSED" ? Boolean(value.reason) : true),
    {
      message: "سبب التعليق أو الإغلاق مطلوب.",
      path: ["reason"],
    }
  );

export type UpdateCompanyInput = z.infer<typeof UpdateCompanySchema>;
export type ListCompaniesInput = z.infer<typeof ListCompaniesSchema>;
export type SetCompanyStatusInput = z.infer<typeof SetCompanyStatusSchema>;
