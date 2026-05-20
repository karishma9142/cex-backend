import mongoose from "mongoose";

const FillSchema = new mongoose.Schema(
  {
    // e.g. "BTC/INR" — needed for getRecentTrades query
    symbol: {
      type:      String,
      required:  true,
      uppercase: true,
    },

    stockId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      "market",
      required: true,
    },

    price: {
      type:     Number,
      required: true,
    },

    qty: {
      type:     Number,
      required: true,
    },

    buyOrderId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      "order",
      required: true,
    },

    sellOrderId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      "order",
      required: true,
    },
  },
  { timestamps: true }
);

// Indexes
FillSchema.index({ symbol: 1, createdAt: -1 });
FillSchema.index({ buyOrderId: 1 });
FillSchema.index({ sellOrderId: 1 });

const FillModel = mongoose.model("fill", FillSchema);
export default FillModel;