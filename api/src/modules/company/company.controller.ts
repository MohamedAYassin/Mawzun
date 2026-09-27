import { param, type AuthedRequest } from "../../shared/request.js";
import { companyService } from "./company.service.js";
import {
  ListCompaniesSchema,
  SetCompanyStatusSchema,
  UpdateCompanySchema,
} from "./company.schemas.js";

export const companyController = {
  getProfile(req: AuthedRequest) {
    return companyService.getProfile(req);
  },

  updateProfile(req: AuthedRequest) {
    return companyService.updateProfile(req, UpdateCompanySchema.parse(req.body));
  },
};

export const platformCompanyController = {
  list(req: AuthedRequest) {
    return companyService.listAll(ListCompaniesSchema.parse(req.query));
  },

  setStatus(req: AuthedRequest) {
    return companyService.setStatus(
      req,
      param(req, "id"),
      SetCompanyStatusSchema.parse(req.body)
    );
  },
};
