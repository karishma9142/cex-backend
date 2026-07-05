import redis from "../config/redis.js";
import WalletModel       from "../models/Wallet.js";
import TransactionModel  from "../models/Transaction.js";

const SUPPORTED_ASSETS = ["INR", "BTC", "ETH", "SOL"];

// ─────────────────────────────────────────────────────────────
// INTERNAL HELPERS
// ─────────────────────────────────────────────────────────────

async function syncWalletToRedis(wallet) {
  const key    = `wallet:${wallet.userId}`;
  const fields = {};
  for (const asset of SUPPORTED_ASSETS) {
    const bal = wallet.balances[asset] ?? { available: 0, locked: 0 };
    fields[`${asset}_available`] = String(bal.available);
    fields[`${asset}_locked`]    = String(bal.locked);
  }
  await redis.hset(key, fields);
}

async function getRedisWallet(userId) {
  const raw = await redis.hgetall(`wallet:${userId}`);
  if (!raw || Object.keys(raw).length === 0) return null;
  const parsed = {};
  for (const [field, value] of Object.entries(raw)) {
    parsed[field] = Number(value);
  }
  return parsed;
}

// ─────────────────────────────────────────────────────────────
// POST /api/wallet/create
// Called inside authController right after user registers.
// ─────────────────────────────────────────────────────────────
export const createWallet = async (req, res) => {
  try {
    const userId = req.user_id;

    const existing = await WalletModel.findOne({ userId });
    if (existing) {
      return res.status(409).json({ message: "Wallet already exists" });
    }

    const wallet = await WalletModel.create({ userId });
    await syncWalletToRedis(wallet);

    return res.status(201).json({ message: "Wallet created", userId });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────
// GET /api/wallet
// Reads from Redis (fast). Falls back to MongoDB if Redis is empty.
// ─────────────────────────────────────────────────────────────
export const getWallet = async (req, res) => {
  try {
    const userId = req.user_id;

    let wallet = await getRedisWallet(userId);

    // Redis miss — rebuild from MongoDB (happens after Redis flush/crash)
    if (!wallet) {
      const doc = await WalletModel.findOne({ userId });
      if (!doc) {
        return res.status(404).json({ message: "Wallet not found" });
      }
      await syncWalletToRedis(doc);
      wallet = await getRedisWallet(userId);
    }

    return res.status(200).json({ userId, wallet });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────
// POST /api/wallet/deposit
// Body: { asset, amount, txHash?, reference? }
//
// In production, call this from:
//   - Razorpay / PayU webhook for INR deposits
//   - On-chain listener for BTC/ETH/SOL deposits
// ─────────────────────────────────────────────────────────────
export const deposit = async (req, res) => {
  try {
    const userId = req.user_id;
    const { asset, amount, txHash, reference } = req.body;

    const upperAsset = asset?.toUpperCase();
    if (!SUPPORTED_ASSETS.includes(upperAsset)) {
      return res.status(400).json({
        message: `Unsupported asset. Supported: ${SUPPORTED_ASSETS.join(", ")}`,
      });
    }

    const parsedAmount = Number(amount);
    if (!parsedAmount || parsedAmount <= 0) {
      return res.status(400).json({ message: "Amount must be a positive number" });
    }

    // Update MongoDB
    const wallet = await WalletModel.findOneAndUpdate(
      { userId },
      { $inc: { [`balances.${upperAsset}.available`]: parsedAmount } },
      { new: true }
    );
    console.log(wallet);
    if (!wallet) {
      return res.status(404).json({ message: "Wallet not found" });
    }

    // Update Redis
    await redis.hincrbyfloat(`wallet:${userId}`, `${upperAsset}_available`, parsedAmount);

    // Record transaction
    const newBal = wallet.balances[upperAsset];
    await TransactionModel.create({
      userId,
      type:         "deposit",
      asset:        upperAsset,
      amount:       parsedAmount,
      status:       "completed",
      balanceAfter: { available: newBal.available, locked: newBal.locked },
      txHash:       txHash    ?? null,
      reference:    reference ?? null,
    });

    return res.status(200).json({
      message: `Deposited ${parsedAmount} ${upperAsset}`,
      balance: { available: newBal.available, locked: newBal.locked },
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────
// POST /api/wallet/withdraw
// Body: { asset, amount }
//
// Guards:
//   - Only available balance can be withdrawn (not locked funds)
//   - MongoDB filter acts as a second atomic check against race conditions
// ─────────────────────────────────────────────────────────────
export const withdraw = async (req, res) => {
  try {
    const userId = req.user_id;
    const { asset, amount } = req.body;

    const upperAsset = asset?.toUpperCase();
    if (!SUPPORTED_ASSETS.includes(upperAsset)) {
      return res.status(400).json({
        message: `Unsupported asset. Supported: ${SUPPORTED_ASSETS.join(", ")}`,
      });
    }

    const parsedAmount = Number(amount);
    if (!parsedAmount || parsedAmount <= 0) {
      return res.status(400).json({ message: "Amount must be a positive number" });
    }

    // Check live balance from Redis
    const redisKey  = `wallet:${userId}`;
    const available = Number(await redis.hget(redisKey, `${upperAsset}_available`) ?? 0);
    const locked    = Number(await redis.hget(redisKey, `${upperAsset}_locked`)    ?? 0);

    if (available < parsedAmount) {
      return res.status(400).json({
        message:   `Insufficient available ${upperAsset}`,
        available,
        locked,
        requested: parsedAmount,
        note: locked > 0
          ? `${locked} ${upperAsset} is locked in open orders and cannot be withdrawn`
          : undefined,
      });
    }

    // Deduct from MongoDB — filter also checks balance to catch race conditions
    const wallet = await WalletModel.findOneAndUpdate(
      {
        userId,
        [`balances.${upperAsset}.available`]: { $gte: parsedAmount },
      },
      { $inc: { [`balances.${upperAsset}.available`]: -parsedAmount } },
      { new: true }
    );

    if (!wallet) {
      return res.status(400).json({ message: "Insufficient balance" });
    }

    // Deduct from Redis
    await redis.hincrbyfloat(redisKey, `${upperAsset}_available`, -parsedAmount);

    // Record transaction
    const newBal = wallet.balances[upperAsset];
    await TransactionModel.create({
      userId,
      type:         "withdraw",
      asset:        upperAsset,
      amount:       parsedAmount,
      status:       "completed",
      balanceAfter: { available: newBal.available, locked: newBal.locked },
    });

    return res.status(200).json({
      message: `Withdrew ${parsedAmount} ${upperAsset}`,
      balance: { available: newBal.available, locked: newBal.locked },
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────
// GET /api/wallet/transactions
// Query: ?asset=BTC&type=deposit&page=1&limit=20
// ─────────────────────────────────────────────────────────────
export const getTransactions = async (req, res) => {
  try {
    const userId = req.user_id;
    const { asset, type, page = 1, limit = 20 } = req.query;

    const filter = { userId };
    if (asset) filter.asset = asset.toUpperCase();
    if (type)  filter.type  = type;

    const skip  = (Number(page) - 1) * Number(limit);
    const total = await TransactionModel.countDocuments(filter);
    const txns  = await TransactionModel
      .find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean();

    return res.status(200).json({
      total,
      page:         Number(page),
      limit:        Number(limit),
      pages:        Math.ceil(total / Number(limit)),
      transactions: txns,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};