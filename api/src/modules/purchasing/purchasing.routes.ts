import { Router } from "express";
import { purchaseOrderRoutes } from "./purchaseOrders.js";
import { vendorRoutes } from "./vendors.js";

const router = Router();

router.use("/vendors", vendorRoutes);
router.use("/purchase-orders", purchaseOrderRoutes);

export { router as purchasingRoutes };
