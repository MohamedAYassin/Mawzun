import { Router } from "express";
import { carrierReportRoutes } from "./carriers.js";
import { orderReportRoutes } from "./orders.js";
import { overviewRoutes } from "./overview.js";
import { stockReportRoutes } from "./stock.js";

const router = Router();

router.use("/overview", overviewRoutes);
router.use("/orders", orderReportRoutes);
router.use("/carriers", carrierReportRoutes);
router.use("/stock", stockReportRoutes);

export { router as reportRoutes };
