/**
 * seedRedis.js
 *
 * Syncs all active markets from MongoDB → Redis on startup.
 * Import and call this inside index.js — not a standalone script.
 *
 * Why MongoDB is the source of truth:
 *   Redis can be flushed, crash, or be replaced at any time.
 *   MongoDB persists forever. On every restart we just re-sync.
 */

import redis from "../config/redis.js";
import MarketModel from "../models/Market.js";

export async function seedRedis() {
  try {
    console.log("🌱  Seeding Redis from MongoDB...");

    const markets = await MarketModel.find({
      status: { $ne: "delisted" },
    }).lean();

    if (markets.length === 0) {
      console.log(
        "⚠️   No markets in MongoDB yet.\n" +
        "     Hit POST /api/markets to create your first market, then restart.\n"
      );
      return;
    }

    for (const market of markets) {
      const key = `market:${market.symbol}`;

      await redis.hset(key, {
        symbol:         market.symbol,
        baseAsset:      market.baseAsset,
        quoteAsset:     market.quoteAsset,
        status:         market.status,
        pricePrecision: String(market.pricePrecision),
        qtyPrecision:   String(market.qtyPrecision),
        minQty:         String(market.minQty),
        minNotional:    String(market.minNotional),
      });

      console.log(`  ✅  market:${market.symbol}`);
    }

    console.log(`\n🚀  Redis seeded — ${markets.length} market(s) loaded.\n`);
  } catch (err) {
    console.error("❌  Redis seed failed:", err.message);
    process.exit(1); // crash on startup so the problem is obvious
  }
}