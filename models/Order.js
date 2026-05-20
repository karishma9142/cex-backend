import mongoose from "mongoose";

const OrderSchema = new mongoose.Schema(
  {
    userId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      "user",
      required: true,
    },

    side: {
      type:     String,
      enum:     ["buy", "sell"],
      required: true,
    },

    type: {
      type:     String,
      enum:     ["limit", "market"],
      required: true,
    },

    stockId: {
      type: mongoose.Schema.Types.ObjectId,
      ref:  "market",
    },

    // e.g. "BTC/INR" — needed for Redis orderbook keys and cancel logic
    symbol: {
      type:      String,
      required:  true,
      uppercase: true,
    },

    price: {
      type:     Number,
      required: function () { return this.type === "limit"; },
    },

    qty: {
      type:     Number,
      required: true,
    },

    filledQty: {
      type:    Number,
      default: 0,
    },

    status: {
      type:    String,
      enum:    ["open", "partially_filled", "filled", "cancelled"],
      default: "open",
    },
  },
  { timestamps: true }
);

// Indexes for fast queries
OrderSchema.index({ userId: 1, status: 1 });
OrderSchema.index({ userId: 1, symbol: 1 });
OrderSchema.index({ symbol: 1, side: 1, status: 1 });

const OrderModel = mongoose.model("order", OrderSchema);
export default OrderModel;