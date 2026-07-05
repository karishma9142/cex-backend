/**
 * rateLimiter.js
 *
 * Different limits for different route types.
 * Tighter on auth (stop brute force), looser on market data (public reads).
 *
 * Install: npm install express-rate-limit
 */

import rateLimit, { ipKeyGenerator } from "express-rate-limit";

// ── Helper: standard JSON error response ─────────────────────
const handler = (req, res) =>
  res.status(429).json({
    message: "Too many requests — please slow down",
    retryAfter: Math.ceil(req.rateLimit.resetTime / 1000),
  });

// ─────────────────────────────────────────────────────────────
// AUTH routes — very tight (stop brute force login/register)
// 10 requests per 15 minutes per IP
// ─────────────────────────────────────────────────────────────
export const authLimiter = rateLimit({
  windowMs:         15 * 60 * 1000,
  max:              10,
  standardHeaders:  true,
  legacyHeaders:    false,
  handler,
});

// ─────────────────────────────────────────────────────────────
// ORDER routes — moderate (prevent spam orders)
// 60 requests per minute per user (keyed by userId from JWT)
// Falls back to IP if no userId
// ─────────────────────────────────────────────────────────────
export const orderLimiter = rateLimit({
  windowMs:        60 * 1000,
  max:             60,
  keyGenerator:    (req) => req.user_id ?? ipKeyGenerator(req),
  standardHeaders: true,
  legacyHeaders:   false,
  handler,
});

// ─────────────────────────────────────────────────────────────
// WALLET routes — tight (prevent deposit/withdraw flooding)
// 20 requests per minute per user
// ─────────────────────────────────────────────────────────────
export const walletLimiter = rateLimit({
  windowMs:        60 * 1000,
  max:             20,
  keyGenerator:    (req) => req.user_id ?? ipKeyGenerator(req),
  standardHeaders: true,
  legacyHeaders:   false,
  handler,
});

// ─────────────────────────────────────────────────────────────
// MARKET DATA routes — generous (public reads, frontend polls these)
// 300 requests per minute per IP
// ─────────────────────────────────────────────────────────────
export const marketDataLimiter = rateLimit({
  windowMs:        60 * 1000,
  max:             300,
  standardHeaders: true,
  legacyHeaders:   false,
  handler,
});