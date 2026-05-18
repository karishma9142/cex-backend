import mongoose from "mongoose";

const MarketSchema = new mongoose.Schema(
  {
    symbol: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      // e.g. "BTC/INR"
    },

    baseAsset: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      // e.g. "BTC"
    },

    quoteAsset: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      // e.g. "INR"
    },

    status: {
      type: String,
      enum: ["active", "paused", "delisted"],
      default: "active",
    },

    // Price precision — how many decimal places are allowed
    pricePrecision: {
      type: Number,
      default: 2,
    },

    // Quantity precision
    qtyPrecision: {
      type: Number,
      default: 8,
    },

    // Minimum order size in base asset
    minQty: {
      type: Number,
      default: 0.0001,
    },

    // Minimum order value in quote asset (INR)
    minNotional: {
      type: Number,
      default: 100,
    },
  },
  { timestamps: true }
);

const MarketModel = mongoose.model("market", MarketSchema);
export default MarketModel;