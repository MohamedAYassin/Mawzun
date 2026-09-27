import { Router } from "express";
import { carrierRoutes } from "./carriers.js";
import { cityLookupRoutes, cityRoutes } from "./cities.js";
import { countryRoutes } from "./countries.js";
import { governoratesRoutes } from "./governorates.js";

const router = Router();

router.use("/countries", countryRoutes);
router.use("/carriers", carrierRoutes);
router.use("/cities", cityLookupRoutes);

router.use("/governorates", governoratesRoutes);
// Mounted after the governorate router: a three-segment path never matches
// `/:id`, so it falls through to here.
router.use("/governorates/:governorateId/cities", cityRoutes);

export { router as shippingRoutes };
