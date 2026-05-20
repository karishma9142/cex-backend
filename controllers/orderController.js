import redis           from "../config/redis.js";
import OrderModel       from "../models/Order.js";
import FillModel        from "../models/Fill.js";
import WalletModel      from "../models/Wallet.js";
import logger          from "../config/logger.js";
import { emitOrderbookUpdate, emitTrade, emitOrderUpdate } from "../socket.js";

// ─────────────────────────────────────────────────────────────
// INTERNAL HELPERS
// ─────────────────────────────────────────────────────────────

async function adjustBalance(userId, asset, field, delta) {
  await redis.hincrbyfloat(`wallet:${userId}`, `${asset}_${field}`, delta);
  await WalletModel.findOneAndUpdate(
    { userId },
    { $inc: { [`balances.${asset}.${field}`]: delta } }
  );
}
 
async function settleFill(buyerId, sellerId, asset, tradeQty, tradeCost) {
  await adjustBalance(buyerId,  "INR",  "locked",    -tradeCost);
  await adjustBalance(buyerId,  asset,  "available",  tradeQty);
  await adjustBalance(sellerId, asset,  "locked",    -tradeQty);
  await adjustBalance(sellerId, "INR",  "available",  tradeCost);
}

// ─────────────────────────────────────────────────────────────
// POST /api/orders
// ─────────────────────────────────────────────────────────────
export const placeOrder = async (req, res) => {
  try {
    const userId = req.userId;
    // body is already validated + sanitised by Zod middleware
    const { side, type, stockId, symbol, price, qty } = req.body;
 
    const market = await redis.hgetall(`market:${symbol}`);
    if (!market || Object.keys(market).length === 0)
      return res.status(404).json({ message: `Market ${symbol} not found` });
    if (market.status !== "active")
      return res.status(400).json({ message: `Market ${symbol} is ${market.status}` });
 
    const baseAsset = market.baseAsset;
    const walletKey = `wallet:${userId}`;
    const wallet    = await redis.hgetall(walletKey);
 
    if (!wallet || Object.keys(wallet).length === 0)
      return res.status(404).json({ message: "Wallet not found" });
 
    if (side === "buy" && type === "limit") {
      const cost         = price * qty;
      const availableINR = Number(wallet.INR_available ?? 0);
      if (availableINR < cost)
        return res.status(400).json({ message: "Insufficient INR", available: availableINR, required: cost });
      await adjustBalance(userId, "INR", "available", -cost);
      await adjustBalance(userId, "INR", "locked",     cost);
    }
 
    if (side === "sell") {
      const availableAsset = Number(wallet[`${baseAsset}_available`] ?? 0);
      if (availableAsset < qty)
        return res.status(400).json({ message: `Insufficient ${baseAsset}`, available: availableAsset, required: qty });
      await adjustBalance(userId, baseAsset, "available", -qty);
      await adjustBalance(userId, baseAsset, "locked",     qty);
    }
 
    const takerOrder = await OrderModel.create({
      userId, side, type, stockId, symbol,
      price: type === "limit" ? price : undefined,
      qty, filledQty: 0, status: "open",
    });
 
    logger.info("Order created", { orderId: takerOrder._id, userId, side, type, symbol, price, qty });
 
    let remainingQty = qty;
    const fills      = [];
 
    const oppositeSide = side === "buy" ? "sell" : "buy";
    const bookKey      = `orderbook:${symbol}:${oppositeSide}`;
 
    const makerIds = oppositeSide === "sell"
      ? await redis.zrange(bookKey, 0, -1)
      : await redis.zrange(bookKey, 0, -1, "REV");
 
    for (const makerId of makerIds) {
      if (remainingQty <= 0) break;
 
      const makerOrder = await OrderModel.findById(makerId);
      if (!makerOrder || ["filled", "cancelled"].includes(makerOrder.status)) {
        await redis.zrem(bookKey, makerId);
        continue;
      }
 
      const makerPrice = makerOrder.price;
      if (type === "limit") {
        if (side === "buy"  && price < makerPrice) break;
        if (side === "sell" && price > makerPrice) break;
      }
 
      if (side === "buy" && type === "market") {
        const fw       = await redis.hgetall(walletKey);
        const avl      = Number(fw.INR_available ?? 0);
        const fillCost = makerPrice * Math.min(remainingQty, makerOrder.qty - (makerOrder.filledQty ?? 0));
        if (avl < fillCost) break;
        await adjustBalance(userId, "INR", "available", -fillCost);
        await adjustBalance(userId, "INR", "locked",     fillCost);
      }
 
      const makerAvailable = makerOrder.qty - (makerOrder.filledQty ?? 0);
      const tradeQty       = Math.min(remainingQty, makerAvailable);
      const tradeCost      = makerPrice * tradeQty;
      const buyerId        = side === "buy"  ? userId : String(makerOrder.userId);
      const sellerId       = side === "sell" ? userId : String(makerOrder.userId);
 
      const fill = await FillModel.create({
        stockId, symbol,
        price: makerPrice, qty: tradeQty,
        buyOrderId:  side === "buy"  ? takerOrder._id : makerOrder._id,
        sellOrderId: side === "sell" ? takerOrder._id : makerOrder._id,
      });
      fills.push(fill);
 
      logger.info("Fill created", { fillId: fill._id, symbol, price: makerPrice, qty: tradeQty });
 
      // ── Emit real-time trade to subscribers ──
      emitTrade(fill);
 
      await settleFill(buyerId, sellerId, baseAsset, tradeQty, tradeCost);
 
      makerOrder.filledQty = (makerOrder.filledQty ?? 0) + tradeQty;
      makerOrder.status    = makerOrder.filledQty >= makerOrder.qty ? "filled" : "partially_filled";
      await makerOrder.save();
 
      // ── Emit maker order update to its owner ──
      emitOrderUpdate(makerOrder);
 
      if (makerOrder.status === "filled") await redis.zrem(bookKey, makerId);
 
      remainingQty -= tradeQty;
    }
 
    takerOrder.filledQty = qty - remainingQty;
    takerOrder.status    = remainingQty === 0 ? "filled"
      : takerOrder.filledQty > 0 ? "partially_filled" : "open";
 
    if (remainingQty > 0 && type === "limit")
      await redis.zadd(`orderbook:${symbol}:${side}`, price, takerOrder._id.toString());
 
    if (remainingQty > 0 && type === "market") {
      takerOrder.status = "cancelled";
      if (side === "sell") {
        await adjustBalance(userId, baseAsset, "locked",    -remainingQty);
        await adjustBalance(userId, baseAsset, "available",  remainingQty);
      }
    }
 
    await takerOrder.save();
 
    // ── Emit taker order update + updated orderbook ──
    emitOrderUpdate(takerOrder);
    await emitOrderbookUpdate(symbol);
 
    logger.info("Order processed", { orderId: takerOrder._id, status: takerOrder.status, fills: fills.length });
 
    return res.status(201).json({ message: "Order processed", order: takerOrder, fills });
  } catch (err) {
    logger.error("placeOrder failed", { error: err.message, stack: err.stack });
    return res.status(500).json({ message: err.message });
  }
};
 
// ─────────────────────────────────────────────────────────────
// DELETE /api/orders/:orderId
// ─────────────────────────────────────────────────────────────
export const cancelOrder = async (req, res) => {
  try {
    const userId      = req.userId;
    const { orderId } = req.params;
 
    const order = await OrderModel.findById(orderId);
    if (!order)
      return res.status(404).json({ message: "Order not found" });
    if (String(order.userId) !== String(userId))
      return res.status(403).json({ message: "Not your order" });
    if (!["open", "partially_filled"].includes(order.status))
      return res.status(400).json({ message: `Cannot cancel a ${order.status} order` });
 
    const unfilledQty = order.qty - (order.filledQty ?? 0);
    const market      = await redis.hgetall(`market:${order.symbol}`);
    const baseAsset   = market?.baseAsset ?? order.symbol.split("/")[0];
 
    if (order.side === "buy") {
      const refundINR = order.price * unfilledQty;
      await adjustBalance(userId, "INR", "locked",    -refundINR);
      await adjustBalance(userId, "INR", "available",  refundINR);
    } else {
      await adjustBalance(userId, baseAsset, "locked",    -unfilledQty);
      await adjustBalance(userId, baseAsset, "available",  unfilledQty);
    }
 
    await redis.zrem(`orderbook:${order.symbol}:${order.side}`, orderId);
    order.status = "cancelled";
    await order.save();
 
    // ── Emit cancel to user + updated orderbook ──
    emitOrderUpdate(order);
    await emitOrderbookUpdate(order.symbol);
 
    logger.info("Order cancelled", { orderId, userId });
 
    return res.status(200).json({ message: "Order cancelled", order });
  } catch (err) {
    logger.error("cancelOrder failed", { error: err.message });
    return res.status(500).json({ message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────
// GET /api/orders
// My orders list — query: ?status=open&symbol=BTC/INR&side=buy&page=1&limit=20
// ─────────────────────────────────────────────────────────────
export const getMyOrders = async (req, res) => {
  try {
    const userId = req.userId;
    const { status, symbol, side, page = 1, limit = 20 } = req.query;

    const filter = { userId };
    if (status) filter.status = status;
    if (symbol) filter.symbol = symbol.toUpperCase();
    if (side)   filter.side   = side;

    const skip   = (Number(page) - 1) * Number(limit);
    const total  = await OrderModel.countDocuments(filter);
    const orders = await OrderModel.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean();

    return res.status(200).json({ total, page: Number(page), pages: Math.ceil(total / Number(limit)), orders });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────
// GET /api/orders/:orderId
// Single order + its fills
// ─────────────────────────────────────────────────────────────
export const getOrder = async (req, res) => {
  try {
    const userId      = req.userId;
    const { orderId } = req.params;

    const order = await OrderModel.findById(orderId).lean();
    if (!order)
      return res.status(404).json({ message: "Order not found" });
    if (String(order.userId) !== String(userId))
      return res.status(403).json({ message: "Not your order" });

    const fills = await FillModel.find({
      $or: [{ buyOrderId: orderId }, { sellOrderId: orderId }],
    }).lean();

    return res.status(200).json({ order, fills });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────
// GET /api/orderbook/:symbol
// L2 price ladder — public
// Query: ?depth=20
//
// Response shape (what every frontend expects):
// {
//   symbol: "BTC/INR",
//   bids: [{ price, qty }, ...],   ← sorted high→low
//   asks: [{ price, qty }, ...],   ← sorted low→high
// }
// ─────────────────────────────────────────────────────────────
export const getOrderbook = async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const depth  = Math.min(Number(req.query.depth ?? 20), 100);

    const [buyRaw, sellRaw] = await Promise.all([
      redis.zrange(`orderbook:${symbol}:buy`,  0, depth - 1, "REV", "WITHSCORES"),
      redis.zrange(`orderbook:${symbol}:sell`, 0, depth - 1,        "WITHSCORES"),
    ]);

    // Aggregate qty at same price level
    async function buildLevels(raw) {
      const priceMap = new Map();
      for (let i = 0; i < raw.length; i += 2) {
        const orderId = raw[i];
        const price   = Number(raw[i + 1]);
        const order   = await OrderModel.findById(orderId, "qty filledQty").lean();
        if (!order) continue;
        const remaining = order.qty - (order.filledQty ?? 0);
        priceMap.set(price, (priceMap.get(price) ?? 0) + remaining);
      }
      return Array.from(priceMap.entries()).map(([price, qty]) => ({ price, qty }));
    }

    const [bids, asks] = await Promise.all([buildLevels(buyRaw), buildLevels(sellRaw)]);

    return res.status(200).json({ symbol, bids, asks });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────
// GET /api/trades/:symbol
// Recent fills (public trade history / last trades tape)
// Query: ?limit=50
// ─────────────────────────────────────────────────────────────
export const getRecentTrades = async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const limit  = Math.min(Number(req.query.limit ?? 50), 200);

    const trades = await FillModel
      .find({ symbol })
      .sort({ createdAt: -1 })
      .limit(limit)
      .select("price qty createdAt buyOrderId sellOrderId")
      .lean();

    return res.status(200).json({ symbol, trades });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────
// GET /api/ticker/:symbol
// 24h stats — last price, 24h high/low/volume/change
// Powers the price header on every trading page
// ─────────────────────────────────────────────────────────────
export const getTicker = async (req, res) => {
  try {
    const symbol  = req.params.symbol.toUpperCase();
    const since24 = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const fills = await FillModel
      .find({ symbol, createdAt: { $gte: since24 } })
      .sort({ createdAt: 1 })
      .select("price qty createdAt")
      .lean();

    if (fills.length === 0) {
      return res.status(200).json({ symbol, lastPrice: null, message: "No trades in last 24h" });
    }

    const prices    = fills.map(f => f.price);
    const lastPrice = prices[prices.length - 1];
    const openPrice = prices[0];
    const high24h   = Math.max(...prices);
    const low24h    = Math.min(...prices);
    const volume24h = fills.reduce((sum, f) => sum + f.qty, 0);
    const change24h = ((lastPrice - openPrice) / openPrice) * 100;

    return res.status(200).json({
      symbol,
      lastPrice,
      openPrice,
      high24h,
      low24h,
      volume24h: Number(volume24h.toFixed(8)),
      change24h: Number(change24h.toFixed(2)),
      trades24h: fills.length,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────
// GET /api/tickers
// All market tickers at once — for the markets list page
// ─────────────────────────────────────────────────────────────
export const getAllTickers = async (req, res) => {
  try {
    const since24  = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Get all active market symbols from Redis keys
    const keys    = await redis.keys("market:*");
    const symbols = keys.map(k => k.replace("market:", ""));

    const tickers = await Promise.all(
      symbols.map(async (symbol) => {
        const market = await redis.hgetall(`market:${symbol}`);
        if (market.status !== "active") return null;

        const fills = await FillModel
          .find({ symbol, createdAt: { $gte: since24 } })
          .select("price qty")
          .lean();

        if (fills.length === 0) {
          return { symbol, lastPrice: null, change24h: 0, volume24h: 0 };
        }

        const prices    = fills.map(f => f.price);
        const lastPrice = prices[prices.length - 1];
        const openPrice = prices[0];
        const volume24h = fills.reduce((sum, f) => sum + f.qty, 0);
        const change24h = ((lastPrice - openPrice) / openPrice) * 100;

        return {
          symbol,
          lastPrice,
          change24h:  Number(change24h.toFixed(2)),
          volume24h:  Number(volume24h.toFixed(8)),
          high24h:    Math.max(...prices),
          low24h:     Math.min(...prices),
        };
      })
    );

    return res.status(200).json({ tickers: tickers.filter(Boolean) });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────
// GET /api/ohlcv/:symbol
// Candlestick data for the price chart
// Query: ?interval=1m|5m|15m|1h|4h|1d  &limit=100
// ─────────────────────────────────────────────────────────────
export const getOHLCV = async (req, res) => {
  try {
    const symbol   = req.params.symbol.toUpperCase();
    const interval = req.query.interval ?? "1h";
    const limit    = Math.min(Number(req.query.limit ?? 100), 1000);

    // Map interval string to milliseconds
    const intervalMap = {
      "1m":  60_000,
      "5m":  300_000,
      "15m": 900_000,
      "1h":  3_600_000,
      "4h":  14_400_000,
      "1d":  86_400_000,
    };
    const intervalMs = intervalMap[interval];
    if (!intervalMs)
      return res.status(400).json({ message: `Invalid interval. Use: ${Object.keys(intervalMap).join(", ")}` });

    const since = new Date(Date.now() - intervalMs * limit);

    const fills = await FillModel
      .find({ symbol, createdAt: { $gte: since } })
      .sort({ createdAt: 1 })
      .select("price qty createdAt")
      .lean();

    if (fills.length === 0)
      return res.status(200).json({ symbol, interval, candles: [] });

    // Group fills into candles
    const candleMap = new Map();

    for (const fill of fills) {
      const ts     = fill.createdAt.getTime();
      const bucket = Math.floor(ts / intervalMs) * intervalMs;

      if (!candleMap.has(bucket)) {
        candleMap.set(bucket, {
          time:   bucket,
          open:   fill.price,
          high:   fill.price,
          low:    fill.price,
          close:  fill.price,
          volume: fill.qty,
        });
      } else {
        const c    = candleMap.get(bucket);
        c.high     = Math.max(c.high, fill.price);
        c.low      = Math.min(c.low,  fill.price);
        c.close    = fill.price;
        c.volume  += fill.qty;
      }
    }

    const candles = Array.from(candleMap.values()).sort((a, b) => a.time - b.time);

    return res.status(200).json({ symbol, interval, candles });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};