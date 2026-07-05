import express from "express";
import {
  placeOrder, cancelOrder,
  getMyOrders, getOrder,
} from "../controllers/orderController.js";
import { Auth }             from "../middleware/auth.js";
import { orderLimiter }               from "../middleware/rateLimiter.js";
import { validate, placeOrderSchema } from "../middleware/validators.js";

const router = express.Router();

// ── Protected — mounted at /api/orders in server.js ────────────
router.post(
  "/",
  Auth,
  orderLimiter,
  validate(placeOrderSchema),
  placeOrder
);
router.get("/my",          Auth, getMyOrders);
router.get("/my/:orderId", Auth, getOrder);
router.delete("/:orderId", Auth, orderLimiter, cancelOrder);

export default router;