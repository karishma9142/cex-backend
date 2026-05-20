/**
 * logger.js
 *
 * Structured logging with Winston.
 * - Development: colourised, human-readable output to console
 * - Production:  JSON output to console + error.log file
 *
 * Install: npm install winston
 *
 * Usage anywhere:
 *   import logger from "./config/logger.js";
 *   logger.info("Order placed", { orderId, userId, symbol });
 *   logger.error("Match failed", { error: err.message });
 */

import winston from "winston";

const { combine, timestamp, colorize, printf, json, errors } = winston.format;

const isDev = process.env.NODE_ENV !== "production";

// ── Dev format: readable one-liner ───────────────────────────
const devFormat = combine(
  colorize(),
  timestamp({ format: "HH:mm:ss" }),
  errors({ stack: true }),
  printf(({ level, message, timestamp, stack, ...meta }) => {
    const metaStr = Object.keys(meta).length ? " " + JSON.stringify(meta) : "";
    return `${timestamp} ${level}: ${stack ?? message}${metaStr}`;
  })
);

// ── Prod format: structured JSON ──────────────────────────────
const prodFormat = combine(
  timestamp(),
  errors({ stack: true }),
  json()
);

const logger = winston.createLogger({
  level:      process.env.LOG_LEVEL ?? (isDev ? "debug" : "info"),
  format:     isDev ? devFormat : prodFormat,
  transports: [
    new winston.transports.Console(),
    ...(isDev ? [] : [
      new winston.transports.File({
        filename: "logs/error.log",
        level:    "error",
        maxsize:  10 * 1024 * 1024, // 10MB
        maxFiles: 5,
      }),
    ]),
  ],
});

export default logger;