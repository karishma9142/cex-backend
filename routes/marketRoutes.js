import express from "express";
import {
  createMarket,
  getMarkets,
  getMarket,
  updateMarketStatus,
  syncAllMarketsToRedis,
} from "../controllers/marketController.js";
import { Auth } from "../middleware/auth.js";
import { adminMiddleware } from "../middleware/admin.js";

const marketRouter = express.Router();

// ── Public ──────────────────────────────────
marketRouter.get("/",        getMarkets);
marketRouter.get("/:symbol", getMarket);

// ── Admin only ───────────────────────────────
marketRouter.post("/",               Auth, adminMiddleware, createMarket);
marketRouter.patch("/:symbol/status",Auth, adminMiddleware, updateMarketStatus);
marketRouter.post("/sync",           Auth, adminMiddleware, syncAllMarketsToRedis);

export default marketRouter;