/**
 * validators.js
 *
 * Zod schemas for every request body + a reusable validate() middleware factory.
 *
 * Usage:
 *   router.post("/orders", authMiddleware, validate(placeOrderSchema), placeOrder);
 */

import { z } from "zod";

// ─────────────────────────────────────────────────────────────
// MIDDLEWARE FACTORY
// ─────────────────────────────────────────────────────────────
export function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      const errors = result.error.issues.map(e => ({
        field:   e.path.join("."),
        message: e.message,
      }));
      return res.status(400).json({ message: "Validation failed", errors });
    }

    req.body = result.data; // replace with parsed + coerced data
    next();
  };
}

// ─────────────────────────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────────────────────────
export const registerSchema = z.object({
  name:     z.string().min(2).max(50).trim(),
  email:    z.string().email().toLowerCase().trim(),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export const loginSchema = z.object({
  email:    z.string().email(),
  password: z.string().min(1),
});

// ─────────────────────────────────────────────────────────────
// WALLET
// ─────────────────────────────────────────────────────────────
// @ts-ignore
const SUPPORTED_ASSETS = ["INR", "BTC", "ETH", "SOL"] ;

export const depositSchema = z.object({
  asset:     z.enum(SUPPORTED_ASSETS),
  amount:    z.number().positive("Amount must be positive"),
  txHash:    z.string().optional(),
  reference: z.string().optional(),
});

export const withdrawSchema = z.object({
  asset:  z.enum(SUPPORTED_ASSETS),
  amount: z.number().positive("Amount must be positive"),
});

// ─────────────────────────────────────────────────────────────
// ORDERS
// ─────────────────────────────────────────────────────────────
export const placeOrderSchema = z.object({
  side:    z.enum(["buy", "sell"]),
  type:    z.enum(["limit", "market"]),
  symbol:  z.string().min(3).toUpperCase().trim(),
  stockId: z.string().min(24).max(24), // MongoDB ObjectId string

  price: z.number().positive().optional(),
  qty:   z.number().positive("Qty must be positive"),
}).refine(
  data => data.type === "market" || (data.price !== undefined && data.price > 0),
  { message: "price is required for limit orders", path: ["price"] }
);

// ────────────────────────────────────────────────────────────
// MARKETS (admin)
// ─────────────────────────────────────────────────────────────
export const createMarketSchema = z.object({
  symbol:         z.string().min(3).toUpperCase().trim(),
  baseAsset:      z.string().min(1).toUpperCase().trim(),
  quoteAsset:     z.string().min(1).toUpperCase().trim(),
  pricePrecision: z.number().int().min(0).max(8).optional(),
  qtyPrecision:   z.number().int().min(0).max(8).optional(),
  minQty:         z.number().positive().optional(),
  minNotional:    z.number().positive().optional(),
});