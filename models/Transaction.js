import mongoose from "mongoose";

const TransactionSchema = new mongoose.Schema(
  {
    userId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      "user",
      required: true,
    },

    type: {
      type:     String,
      enum:     ["deposit", "withdraw"],
      required: true,
    },

    asset: {
      type:     String,
      required: true,
      uppercase: true,
      // e.g. "INR", "BTC"
    },

    amount: {
      type:     Number,
      required: true,
    },

    status: {
      type:    String,
      enum:    ["pending", "completed", "failed"],
      default: "completed",
      // For now everything completes instantly.
      // In production: INR deposit starts as "pending" until
      // payment gateway webhook confirms it.
    },

    // Snapshot of balances AFTER this transaction
    balanceAfter: {
      available: Number,
      locked:    Number,
    },

    // For crypto: on-chain tx hash
    txHash: {
      type:    String,
      default: null,
    },

    // For INR: payment gateway reference
    reference: {
      type:    String,
      default: null,
    },

    note: {
      type:    String,
      default: null,
    },
  },
  { timestamps: true }
);

// Index for fast user history queries
TransactionSchema.index({ userId: 1, createdAt: -1 });
TransactionSchema.index({ userId: 1, asset: 1 });

const TransactionModel = mongoose.model("transaction", TransactionSchema);
export default TransactionModel;