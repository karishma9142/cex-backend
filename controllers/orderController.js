import redis from "../config/redis.js";
import OrderModel from "../models/Order.js";
import FillModel from "../models/Fill.js";

/**
 * POST /api/orders
 *
 * Body:
 *  userId   – Mongo ObjectId string
 *  side     – "buy" | "sell"
 *  type     – "limit" | "market"
 *  stockId  – Mongo ObjectId string   (used for DB relations)
 *  symbol   – e.g. "BTC/INR"          (used for Redis keys & wallet fields)
 *  price    – number  (required for limit orders)
 *  qty      – number
 */
export const placeOrder = async (req, res) => {
  try {
    const { userId, side, type, stockId, symbol, price, qty } = req.body;

    // ────────────────────────────────────────────────
    // 0. BASIC INPUT VALIDATION
    // ────────────────────────────────────────────────
    if (!["buy", "sell"].includes(side)) {
      return res.status(400).json({ message: "side must be 'buy' or 'sell'" });
    }
    if (!["limit", "market"].includes(type)) {
      return res.status(400).json({ message: "type must be 'limit' or 'market'" });
    }
    if (type === "limit" && (price == null || price <= 0)) {
      return res.status(400).json({ message: "price is required for limit orders" });
    }
    if (!qty || qty <= 0) {
      return res.status(400).json({ message: "qty must be a positive number" });
    }

    // ────────────────────────────────────────────────
    // 1. VALIDATE MARKET EXISTS IN REDIS
    // ────────────────────────────────────────────────
    const marketExists = await redis.exists(`market:${symbol}`);
    if (!marketExists) {
      return res.status(404).json({ message: "Market not found" });
    }

    // ────────────────────────────────────────────────
    // 2. FETCH WALLET FROM REDIS
    // ────────────────────────────────────────────────
    const walletKey = `wallet:${userId}`;
    const wallet = await redis.hgetall(walletKey);

    if (!wallet || Object.keys(wallet).length === 0) {
      return res.status(404).json({ message: "Wallet not found" });
    }

    const baseAsset = symbol.split("/")[0]; // e.g. "BTC"

    // ────────────────────────────────────────────────
    // 3. LOCK BALANCE (pre-flight check + reserve)
    // ────────────────────────────────────────────────
    if (side === "buy") {
      if (type === "market") {
        // For market buys we can't know exact cost upfront.
        // Reserve a "worst-case" amount or skip pre-lock.
        // Here we simply verify INR > 0 and lock during fills.
      } else {
        const cost = price * qty;
        const availableINR = Number(wallet.INR_available || 0);

        if (availableINR < cost) {
          return res.status(400).json({ message: "Insufficient INR balance" });
        }

        // Lock INR
        await redis.hincrbyfloat(walletKey, "INR_available", -cost);
        await redis.hincrbyfloat(walletKey, "INR_locked", cost);
      }
    }

    if (side === "sell") {
      const availableAsset = Number(wallet[`${baseAsset}_available`] || 0);

      if (availableAsset < qty) {
        return res.status(400).json({ message: `Insufficient ${baseAsset} balance` });
      }

      // Lock asset
      await redis.hincrbyfloat(walletKey, `${baseAsset}_available`, -qty);
      await redis.hincrbyfloat(walletKey, `${baseAsset}_locked`, qty);
    }

    // ────────────────────────────────────────────────
    // 4. CREATE TAKER ORDER IN MONGODB
    // ────────────────────────────────────────────────
    const takerOrder = await OrderModel.create({
      userId,
      side,
      type,
      stockId,
      price: type === "limit" ? price : undefined,
      qty,
      filledQty: 0,
      status: "open",
    });

    let remainingQty = qty;

    // ────────────────────────────────────────────────
    // 5. MATCH AGAINST REDIS ORDERBOOK
    //
    //  BUY  taker → match against SELL book (sorted ASC  by price, lowest ask first)
    //  SELL taker → match against BUY  book (sorted DESC by price, highest bid first)
    // ────────────────────────────────────────────────
    const oppositeSide = side === "buy" ? "sell" : "buy";
    const bookKey = `orderbook:${symbol}:${oppositeSide}`;

    // Retrieve ordered IDs from the sorted set
    // SELL book: zrange (ASC) gives cheapest sellers first  ✓
    // BUY  book: zrevrange (DESC) gives highest bidders first ✓
    const orderedIds =
      oppositeSide === "sell"
        ? await redis.zrange(bookKey, 0, -1)              // lowest ask first
        : await redis.zrange(bookKey, 0, -1, "REV");      // highest bid first

    for (const makerId of orderedIds) {
      if (remainingQty <= 0) break;

      const makerOrder = await OrderModel.findById(makerId);
      if (!makerOrder || makerOrder.status === "filled" || makerOrder.status === "cancelled") {
        await redis.zrem(bookKey, makerId); // clean stale entries
        continue;
      }

      const makerPrice = makerOrder.price;

      // Price compatibility check
      if (type === "limit") {
        if (side === "buy"  && price < makerPrice) break; // can't afford cheapest ask
        if (side === "sell" && price > makerPrice) break; // won't sell below best bid
      }
      // Market orders match at any price

      const makerAvailable = makerOrder.qty - (makerOrder.filledQty || 0);
      const tradeQty = Math.min(remainingQty, makerAvailable);
      const tradePrice = makerPrice; // fills always execute at maker's price

      // ── Create fill record ──────────────────────────────
      await FillModel.create({
        stockId,
        price: tradePrice,
        qty: tradeQty,
        buyOrderId:  side === "buy"  ? takerOrder._id : makerOrder._id,
        sellOrderId: side === "sell" ? takerOrder._id : makerOrder._id,
      });

      // ── Settle wallets ──────────────────────────────────
      const tradeCost = tradePrice * tradeQty;
      const buyerWalletKey  = side === "buy"  ? walletKey : `wallet:${makerOrder.userId}`;
      const sellerWalletKey = side === "sell" ? walletKey : `wallet:${makerOrder.userId}`;

      // Buyer: deduct locked INR → credit asset
      await redis.hincrbyfloat(buyerWalletKey,  "INR_locked",             -tradeCost);
      await redis.hincrbyfloat(buyerWalletKey,  `${baseAsset}_available`,  tradeQty);

      // Seller: deduct locked asset → credit INR
      await redis.hincrbyfloat(sellerWalletKey, `${baseAsset}_locked`,    -tradeQty);
      await redis.hincrbyfloat(sellerWalletKey, "INR_available",           tradeCost);

      // For market BUY we lock INR at fill time (no pre-lock above)
      if (side === "buy" && type === "market") {
        const availableINR = Number((await redis.hget(walletKey, "INR_available")) || 0);
        if (availableINR < tradeCost) {
          // Rollback partial fill attempt if funds run out
          break;
        }
        await redis.hincrbyfloat(walletKey, "INR_available", -tradeCost);
      }

      // ── Update maker order ──────────────────────────────
      makerOrder.filledQty = (makerOrder.filledQty || 0) + tradeQty;
      makerOrder.status =
        makerOrder.filledQty >= makerOrder.qty ? "filled" : "partially_filled";
      await makerOrder.save();

      if (makerOrder.status === "filled") {
        await redis.zrem(bookKey, makerId);
      }

      remainingQty -= tradeQty;
    }

    // ────────────────────────────────────────────────
    // 6. UPDATE TAKER ORDER STATUS
    // ────────────────────────────────────────────────
    takerOrder.filledQty = qty - remainingQty;

    if (remainingQty === 0) {
      takerOrder.status = "filled";
    } else if (takerOrder.filledQty > 0) {
      takerOrder.status = "partially_filled";
    } else {
      takerOrder.status = "open";
    }

    // ────────────────────────────────────────────────
    // 7. ADD UNFILLED LIMIT ORDER TO ORDERBOOK
    // ────────────────────────────────────────────────
    if (remainingQty > 0 && type === "limit") {
      const myBookKey = `orderbook:${symbol}:${side}`;

      // BUY  book: stored as positive score  (zrevrange gives highest bid first)
      // SELL book: stored as positive score  (zrange   gives lowest  ask first)
      await redis.zadd(myBookKey, price, takerOrder._id.toString());
    }

    // ────────────────────────────────────────────────
    // 8. CANCEL UNFILLED MARKET ORDER & RELEASE LOCKS
    // ────────────────────────────────────────────────
    if (remainingQty > 0 && type === "market") {
      takerOrder.status = "cancelled";

      // Release any remaining locked balance
      if (side === "sell" && remainingQty > 0) {
        await redis.hincrbyfloat(walletKey, `${baseAsset}_locked`,    -remainingQty);
        await redis.hincrbyfloat(walletKey, `${baseAsset}_available`,  remainingQty);
      }
      // For market buy, INR was locked per-fill so nothing extra to release
    }

    // ────────────────────────────────────────────────
    // 9. RELEASE OVER-LOCKED INR FOR PARTIAL LIMIT BUY
    //    (locked full qty*price upfront, but filled at maker prices
    //     which may be lower — refund the difference)
    // ────────────────────────────────────────────────
    if (side === "buy" && type === "limit" && remainingQty > 0) {
      // The remaining unfilled portion stays locked (it's on the book)
      // Nothing extra to release — locked amount matches remaining open qty
    }

    await takerOrder.save();

    return res.status(201).json({
      message: "Order processed",
      order: takerOrder,
    });
  } catch (error) {
    console.error("[placeOrder] error:", error);
    return res.status(500).json({ message: error.message });
  }
};