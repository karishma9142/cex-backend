import mongoose from "mongoose";

const marketSchema = new mongoose.Schema({
  symbol: {
    type: String,
    unique: true
  },

  isActive: {
    type: Boolean,
    default: true
  }
});

export const MarketModel = mongoose.model(
  "Market",
  marketSchema
);