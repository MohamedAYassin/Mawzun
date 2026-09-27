import { Router } from "express";
import { operationTypeRoutes } from "./operationTypes.js";
import { reorderPointRoutes } from "./reorderPoints.js";
import { stockRoutes } from "./stock.js";
import { stockCountRoutes } from "./stockCounts.js";
import { stockOperationRoutes } from "./stockOperations.js";
import { storageLocationRoutes } from "./storageLocations.js";
import { warehouseRoutes } from "./warehouses.js";

const router = Router();

router.use("/warehouses", warehouseRoutes);
router.use("/storage-locations", storageLocationRoutes);
router.use("/operation-types", operationTypeRoutes);

// Stock reads and corrections sit under /stock so the ledger and the balances
// are visibly the same subsystem.
router.use("/stock", stockRoutes);
router.use("/operations", stockOperationRoutes);
router.use("/counts", stockCountRoutes);
router.use("/reorder-points", reorderPointRoutes);

export { router as inventoryRoutes };
