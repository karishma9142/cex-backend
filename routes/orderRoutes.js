import express from "express";
import {
  placeOrder, cancelOrder,
  getMyOrders, getOrder,
  getOrderbook, getRecentTrades,
  getTicker, getAllTickers, getOHLCV,
} from "../controllers/orderController.js";
import { Auth }             from "../middleware/auth.js";
import { orderLimiter }               from "../middleware/rateLimiter.js";
import { validate, placeOrderSchema } from "../middleware/validators.js";

const router = express.Router();

// ── Public market data ────────────────────────────────────────
router.get("/orderbook/:symbol",  getOrderbook);
router.get("/trades/:symbol",     getRecentTrades);
router.get("/ticker/:symbol",     getTicker);
router.get("/tickers",            getAllTickers);
router.get("/ohlcv/:symbol",      getOHLCV);

// ── Protected ─────────────────────────────────────────────────
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