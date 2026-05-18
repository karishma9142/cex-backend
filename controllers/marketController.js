import redis from "../config/redis.js";
import MarketModel from "../models/Market.js";

// ─────────────────────────────────────────────
// POST /api/markets
// Admin only — creates market in MongoDB + Redis
// Body: { symbol, baseAsset, quoteAsset, pricePrecision?, qtyPrecision?, minQty?, minNotional? }
// ─────────────────────────────────────────────
export const createMarket = async (req, res) => {
  try {
    const {
      symbol,
      baseAsset,
      quoteAsset,
      pricePrecision,
      qtyPrecision,
      minQty,
      minNotional,
    } = req.body;

    if (!symbol || !baseAsset || !quoteAsset) {
      return res.status(400).json({
        message: "symbol, baseAsset and quoteAsset are required",
      });
    }

    const upperSymbol = symbol.toUpperCase();

    // Check duplicate
    const existing = await MarketModel.findOne({ symbol: upperSymbol });
    if (existing) {
      return res.status(409).json({ message: `Market ${upperSymbol} already exists` });
    }

    // Save to MongoDB
    const market = await MarketModel.create({
      symbol:         upperSymbol,
      baseAsset:      baseAsset.toUpperCase(),
      quoteAsset:     quoteAsset.toUpperCase(),
      pricePrecision: pricePrecision ?? 2,
      qtyPrecision:   qtyPrecision   ?? 8,
      minQty:         minQty         ?? 0.0001,
      minNotional:    minNotional    ?? 100,
    });

    // Sync to Redis
    await syncMarketToRedis(market);

    return res.status(201).json({ message: "Market created", market });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

// ─────────────────────────────────────────────
// GET /api/markets
// Public — list all active markets
// ─────────────────────────────────────────────
export const getMarkets = async (req, res) => {
  try {
    const markets = await MarketModel.find({ status: "active" }).lean();
    return res.status(200).json({ markets });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

// ─────────────────────────────────────────────
// GET /api/markets/:symbol
// Public — get single market info
// ─────────────────────────────────────────────
export const getMarket = async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const market = await MarketModel.findOne({ symbol }).lean();

    if (!market) {
      return res.status(404).json({ message: "Market not found" });
    }

    return res.status(200).json({ market });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

// ─────────────────────────────────────────────
// PATCH /api/markets/:symbol/status
// Admin only — pause or delist a market
// Body: { status: "active" | "paused" | "delisted" }
// ─────────────────────────────────────────────
export const updateMarketStatus = async (req, res) => {
  try {
    const symbol    = req.params.symbol.toUpperCase();
    const { status } = req.body;

    if (!["active", "paused", "delisted"].includes(status)) {
      return res.status(400).json({ message: "status must be active, paused or delisted" });
    }

    const market = await MarketModel.findOneAndUpdate(
      { symbol },
      { status },
      { new: true }
    );

    if (!market) {
      return res.status(404).json({ message: "Market not found" });
    }

    // Update Redis too
    await redis.hset(`market:${symbol}`, "status", status);

    return res.status(200).json({ message: `Market ${status}`, market });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

// ─────────────────────────────────────────────
// POST /api/markets/sync
// Admin only — re-syncs all MongoDB markets → Redis
// Useful after a Redis flush or server restart
// ─────────────────────────────────────────────
export const syncAllMarketsToRedis = async (req, res) => {
  try {
    const markets = await MarketModel.find().lean();

    for (const market of markets) {
      await syncMarketToRedis(market);
    }

    return res.status(200).json({
      message: `Synced ${markets.length} markets to Redis`,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

// ─────────────────────────────────────────────
// INTERNAL HELPER
// Writes one market from MongoDB into Redis
// ─────────────────────────────────────────────
export async function syncMarketToRedis(market) {
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
}