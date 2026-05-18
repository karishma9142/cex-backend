import mongoose from "mongoose";

const assetBalanceSchema = new mongoose.Schema(
  {
    available: { type: Number, default: 0 },
    locked:    { type: Number, default: 0 },
  },
  { _id: false }
);

const WalletSchema = new mongoose.Schema(
  {
    userId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      "user",
      required: true,
      unique:   true,
    },

    balances: {
      INR: { type: assetBalanceSchema, default: () => ({}) },
      BTC: { type: assetBalanceSchema, default: () => ({}) },
      ETH: { type: assetBalanceSchema, default: () => ({}) },
      SOL: { type: assetBalanceSchema, default: () => ({}) },
    },
  },
  { timestamps: true }
);

// Helper — get one asset balance
WalletSchema.methods.getBalance = function (asset) {
  return this.balances[asset] ?? { available: 0, locked: 0 };
};

const WalletModel = mongoose.model("wallet", WalletSchema);
export default WalletModel;