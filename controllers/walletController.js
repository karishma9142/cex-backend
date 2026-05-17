import redis from "../config/redis.js";

const SUPPORTED_ASSETS = ["INR", "BTC", "ETH", "SOL"];

// ─────────────────────────────────────────────
// POST /api/wallet/create
// Called automatically after user registers
// Body: { userId }
// ─────────────────────────────────────────────
export const createWallet = async (req, res) => {
  try {
    const { userId } = req.body;

    const key    = `wallet:${userId}`;
    const exists = await redis.exists(key);

    if (exists) {
      return res.status(409).json({ message: "Wallet already exists" });
    }

    const fields = {};
    for (const asset of SUPPORTED_ASSETS) {
      fields[`${asset}_available`] = "0";
      fields[`${asset}_locked`]    = "0";
    }

    await redis.hset(key, fields);

    return res.status(201).json({
      message: "Wallet created",
      userId,
      wallet: fields,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

// ─────────────────────────────────────────────
// GET /api/wallet
// Protected — reads userId from JWT middleware
// ─────────────────────────────────────────────
export const getWallet = async (req, res) => {
  try {
    const userId = req.userId;

    const key    = `wallet:${userId}`;
    const wallet = await redis.hgetall(key);

    if (!wallet || Object.keys(wallet).length === 0) {
      return res.status(404).json({ message: "Wallet not found" });
    }

    const parsed = {};
    for (const [field, value] of Object.entries(wallet)) {
      parsed[field] = Number(value);
    }

    return res.status(200).json({ userId, wallet: parsed });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

// ─────────────────────────────────────────────
// POST /api/wallet/deposit
// In production: triggered by payment gateway webhook
// Body: { asset, amount }
// ─────────────────────────────────────────────
export const deposit = async (req, res) => {
  try {
    const userId       = req.userId;
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

    const key    = `wallet:${userId}`;
    const exists = await redis.exists(key);
    if (!exists) {
      return res.status(404).json({ message: "Wallet not found" });
    }

    await redis.hincrbyfloat(key, `${upperAsset}_available`, parsedAmount);

    const updated = await redis.hgetall(key);
    const parsed  = {};
    for (const [field, value] of Object.entries(updated)) {
      parsed[field] = Number(value);
    }

    return res.status(200).json({
      message: `Deposited ${parsedAmount} ${upperAsset}`,
      wallet: parsed,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

// ─────────────────────────────────────────────
// POST /api/wallet/withdraw
// Body: { asset, amount }
// ─────────────────────────────────────────────
export const withdraw = async (req, res) => {
  try {
    const userId       = req.userId;
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

    const key       = `wallet:${userId}`;
    const available = Number(await redis.hget(key, `${upperAsset}_available`) || 0);

    if (available < parsedAmount) {
      return res.status(400).json({
        message: `Insufficient ${upperAsset}. Available: ${available}`,
      });
    }

    await redis.hincrbyfloat(key, `${upperAsset}_available`, -parsedAmount);

    const updated = await redis.hgetall(key);
    const parsed  = {};
    for (const [field, value] of Object.entries(updated)) {
      parsed[field] = Number(value);
    }

    return res.status(200).json({
      message: `Withdrew ${parsedAmount} ${upperAsset}`,
      wallet: parsed,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};