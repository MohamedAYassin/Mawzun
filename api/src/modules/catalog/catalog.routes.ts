import { Router } from "express";
import { attributeRoutes } from "./attributes.js";
import { attributeValueRoutes } from "./attributeValues.js";
import { brandRoutes } from "./brands.js";
import { categoryRoutes } from "./categories.js";
import { mergeRoutes } from "./merges.js";
import { productImageRoutes } from "./productImages.js";
import { productRoutes } from "./products.js";
import { taxRateRoutes } from "./taxRates.js";
import { uomRoutes } from "./uoms.js";

const router = Router();

router.use("/brands", brandRoutes);
router.use("/categories", categoryRoutes);
router.use("/uoms", uomRoutes);
router.use("/tax-rates", taxRateRoutes);

router.use("/attributes", attributeRoutes);
// Mounted after the attribute router: a three-segment path never matches
// `/:id`, so it falls through to here.
router.use("/attributes/:attributeId/values", attributeValueRoutes);

router.use("/products", productRoutes);
router.use("/products/:productId/images", productImageRoutes);
router.use("/merges", mergeRoutes);

export { router as catalogRoutes };
