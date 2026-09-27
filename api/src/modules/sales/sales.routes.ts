import { Router } from "express";
import { customerRoutes } from "./customers.js";
import { couponRoutes } from "./coupons.js";
import { fulfillmentBatchRoutes, shippingReturnRoutes } from "./fulfillment.js";
import { cancelReasonRoutes, orderSourceRoutes, paymentMethodRoutes } from "./orderConfig.js";
import { orderRoutes } from "./orders.js";

const router = Router();

router.use("/customers", customerRoutes);
router.use("/orders", orderRoutes);
router.use("/coupons", couponRoutes);

router.use("/order-sources", orderSourceRoutes);
router.use("/payment-methods", paymentMethodRoutes);
router.use("/cancel-reasons", cancelReasonRoutes);

router.use("/fulfillment-batches", fulfillmentBatchRoutes);
router.use("/shipping-returns", shippingReturnRoutes);

export { router as salesRoutes };
