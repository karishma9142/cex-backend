/**
 * socket.js
 *
 * Rooms a client can join:
 *   orderbook:{symbol}   → emits "orderbook" on every order place/cancel
 *   trades:{symbol}      → emits "trade"     on every fill
 *   ticker:{symbol}      → emits "ticker"    every 2s (price/24h stats)
 *   orders:{userId}      → emits "order"     when the user's order changes (auth required)
 */

import { Server } from "socket.io";
import jwt        from "jsonwebtoken";
import FillModel  from "./models/Fill.js";
import OrderModel from "./models/Order.js";
import redis      from "./config/redis.js";

let io = null;

// ─────────────────────────────────────────────────────────────
// INIT — call this once in index.js with the http server
// ─────────────────────────────────────────────────────────────
export function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: "*", methods: ["GET", "POST"] },
  });

  // ── Auth middleware for protected rooms ───────────────────
  // Clients pass token as handshake query: io({ query: { token } })
  io.use((socket, next) => {
    const token = socket.handshake.query?.token;
    if (token) {
      try {
        const payload  = jwt.verify(token, process.env.JWT_SECRET);
        socket.userId  = String(payload.user_id);
      } catch {
        // Token invalid — socket still connects but userId is unset
        // Protected rooms will silently ignore unauthenticated clients
      }
    }
    next();
  });

  io.on("connection", (socket) => {
    console.log(`[WS] connected  ${socket.id}`);

    // ── Join a public room ────────────────────────────────
    socket.on("subscribe", ({ channel }) => {
      if (!channel || typeof channel !== "string") return;

      const [type, symbol] = channel.split(":");
      if (!["orderbook", "trades", "ticker"].includes(type)) return;
      if (!symbol) return;

      socket.join(channel);
      console.log(`[WS] ${socket.id} joined ${channel}`);
    });

    // ── Join the private orders room ──────────────────────
    socket.on("subscribe:orders", () => {
      if (!socket.userId) {
        socket.emit("error", { message: "Auth required" });
        return;
      }
      socket.join(`orders:${socket.userId}`);
    });

    socket.on("unsubscribe", ({ channel }) => {
      socket.leave(channel);
    });

    socket.on("disconnect", () => {
      console.log(`[WS] disconnected ${socket.id}`);
    });
  });

  // ── Ticker broadcast loop (every 2 seconds) ───────────────
  startTickerBroadcast();

  return io;
}

// ─────────────────────────────────────────────────────────────
// EMITTERS — called from orderController after each event
// ─────────────────────────────────────────────────────────────

// Call after every placeOrder / cancelOrder
export async function emitOrderbookUpdate(symbol) {
  if (!io) return;

  const depth = 20;
  const [buyRaw, sellRaw] = await Promise.all([
    redis.zrange(`orderbook:${symbol}:buy`,  0, depth - 1, "REV", "WITHSCORES"),
    redis.zrange(`orderbook:${symbol}:sell`, 0, depth - 1,        "WITHSCORES"),
  ]);

  async function buildLevels(raw) {
    const priceMap = new Map();
    for (let i = 0; i < raw.length; i += 2) {
      const orderId = raw[i];
      const price   = Number(raw[i + 1]);
      const order   = await OrderModel.findById(orderId, "qty filledQty").lean();
      if (!order) continue;
      priceMap.set(price, (priceMap.get(price) ?? 0) + (order.qty - (order.filledQty ?? 0)));
    }
    return Array.from(priceMap.entries()).map(([price, qty]) => ({ price, qty }));
  }

  const [bids, asks] = await Promise.all([buildLevels(buyRaw), buildLevels(sellRaw)]);
  io.to(`orderbook:${symbol}`).emit("orderbook", { symbol, bids, asks });
}

// Call after every fill is created
export function emitTrade(fill) {
  if (!io) return;
  io.to(`trades:${fill.symbol}`).emit("trade", {
    symbol:    fill.symbol,
    price:     fill.price,
    qty:       fill.qty,
    createdAt: fill.createdAt,
  });
}

// Call after every order status change for the user
export function emitOrderUpdate(order) {
  if (!io) return;
  io.to(`orders:${order.userId}`).emit("order", order);
}

// ─────────────────────────────────────────────────────────────
// TICKER BROADCAST LOOP
// Fires every 2s for every room that has at least one subscriber
// ─────────────────────────────────────────────────────────────
async function startTickerBroadcast() {
  setInterval(async () => {
    if (!io) return;
    const rooms = io.sockets.adapter.rooms;

    for (const [room] of rooms) {
      if (!room.startsWith("ticker:")) continue;
      const symbol  = room.replace("ticker:", "");
      const since24 = new Date(Date.now() - 24 * 60 * 60 * 1000);

      try {
        const fills = await FillModel
          .find({ symbol, createdAt: { $gte: since24 } })
          .select("price qty")
          .lean();

        if (fills.length === 0) continue;

        const prices    = fills.map(f => f.price);
        const lastPrice = prices[prices.length - 1];
        const openPrice = prices[0];
        const volume24h = fills.reduce((s, f) => s + f.qty, 0);
        const change24h = ((lastPrice - openPrice) / openPrice) * 100;

        io.to(room).emit("ticker", {
          symbol,
          lastPrice,
          high24h:    Math.max(...prices),
          low24h:     Math.min(...prices),
          volume24h:  Number(volume24h.toFixed(8)),
          change24h:  Number(change24h.toFixed(2)),
        });
      } catch {
        // don't crash the interval on one bad symbol
      }
    }
  }, 2000);
}

export { io };