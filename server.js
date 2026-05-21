/**
 * index.js — production entry point
 *
 * Stack:
 *   Express + http.Server + Socket.io
 *   MongoDB (mongoose) + Redis (ioredis)
 *   Rate limiting (express-rate-limit)
 *   Input validation (zod — applied per-route)
 *   Structured logging (winston)
 *
 * npm install express mongoose ioredis socket.io jsonwebtoken bcrypt
 *            dotenv cors express-rate-limit zod winston
 */

import http     from "http";
import express  from "express";
import mongoose from "mongoose";
import dotenv   from "dotenv";
import cors     from "cors";

import authRoutes   from "./routes/authRoutes.js";
import walletRoutes from "./routes/walletRoutes.js";
import marketRoutes from "./routes/marketRoutes.js";
import orderRoutes  from "./routes/orderRoutes.js";

import { initSocket }      from "./socket.js";
import { seedRedis }       from "./utils//seedRedis.js";
import { authLimiter, marketDataLimiter } from "./middleware/rateLimiter.js";
import logger              from "./config/logger.js";

dotenv.config();

const app    = express();
const server = http.createServer(app); // wrap in http.Server so socket.io can attach

// ── Global middleware ──────────────────────────────────────
app.use(cors());
app.use(express.json());

// ── Request logging (every incoming request) ───────────────
app.use((req, _res, next) => {
  logger.debug(`${req.method} ${req.path}`, { ip: req.ip });
  next();
});

// ── Rate limiting by route group ───────────────────────────
app.use("/api/auth",      authLimiter);
app.use("/api/orderbook", marketDataLimiter);
app.use("/api/trades",    marketDataLimiter);
app.use("/api/ticker",    marketDataLimiter);
app.use("/api/tickers",   marketDataLimiter);
app.use("/api/ohlcv",     marketDataLimiter);

// ── Routes ─────────────────────────────────────────────────
app.use("/api/auth",      authRoutes);
app.use("/api/wallet",    walletRoutes);
app.use("/api/markets",   marketRoutes);
app.use("/api/orders",    orderRoutes);
app.use("/api/orderbook", orderRoutes);
app.use("/api/trades",    orderRoutes);
app.use("/api/ticker",    orderRoutes);
app.use("/api/tickers",   orderRoutes);
app.use("/api/ohlcv",     orderRoutes);

// ── Health check ────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({
    status:   "ok",
    uptime:   process.uptime(),
    memory:   process.memoryUsage(),
    mongoDb:  mongoose.connection.readyState === 1 ? "connected" : "disconnected",
  });
});

// ── 404 ─────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ message: "Route not found" }));

// ── Global error handler ─────────────────────────────────────
app.use((err, _req, res, _next) => {
  logger.error("Unhandled error", { message: err.message, stack: err.stack });
  res.status(500).json({ message: "Internal server error" });
});

// ── Graceful shutdown ────────────────────────────────────────
process.on("SIGTERM", async () => {
  logger.info("SIGTERM received — shutting down gracefully");
  server.close(() => {
    mongoose.connection.close();
    logger.info("Server closed");
    process.exit(0);
  });
});

process.on("uncaughtException",  (err) => logger.error("Uncaught exception",  { err }));
process.on("unhandledRejection", (err) => logger.error("Unhandled rejection", { err }));

// ── Startup ──────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

async function start() {
  await mongoose.connect(process.env.MONGO_URI);
  logger.info("MongoDB connected");

  await seedRedis();

  // Attach Socket.io to the http server
  initSocket(server);
  logger.info("WebSocket server ready");

  server.listen(PORT, () => {
    logger.info(`Server running on port ${PORT}`);
  });
}

start().catch(err => {
  logger.error("Startup failed", { err });
  process.exit(1);
});