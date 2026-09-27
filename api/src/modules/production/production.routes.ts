import { Router } from "express";
import { productionPlanningRoutes } from "./planning.js";
import { productionBatchRoutes } from "./productionBatches.js";

const router = Router();

router.use("/batches", productionBatchRoutes);
router.use("/planning", productionPlanningRoutes);

export { router as productionRoutes };
