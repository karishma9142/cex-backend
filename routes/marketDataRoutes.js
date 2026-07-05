import express from "express";
import {
  getOrderbook, getRecentTrades,
  getTicker, getAllTickers, getOHLCV,
} from "../controllers/orderController.js";

const router = express.Router();

// ── Public market data ────────────────────────────────────────
// Mounted at bare "/api" in server.js, so these resolve to:
//   GET /api/orderbook/:symbol
//   GET /api/trades/:symbol
//   GET /api/ticker/:symbol
//   GET /api/tickers
//   GET /api/ohlcv/:symbol
router.get("/orderbook/:symbol", getOrderbook);
router.get("/trades/:symbol",    getRecentTrades);
router.get("/ticker/:symbol",    getTicker);
router.get("/tickers",           getAllTickers);
router.get("/ohlcv/:symbol",     getOHLCV);

export default router;