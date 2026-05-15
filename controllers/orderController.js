import express from "express";
import redis from "../config/redis.js";

import { OrderModel } from "../models/Order.js";
import { FillModel } from "../models/Fill.js";


export const Order =  async (req, res) => {
  try {
    const { userId, side , type , symbol, price, qty } = req.body;

    // ====================================
    // 1. VALIDATE MARKET IN REDIS
    // ====================================
    const marketExists =
      await redis.exists(
        `market:${symbol}`
      );

    if (!marketExists) {
      return res.status(404).json({
        message:
          "Market not found"
      });
    }

    // ====================================
    // 2. GET WALLET FROM REDIS
    // ====================================
    const walletKey =
      `wallet:${userId}`;

    const wallet =
      await redis.hgetall(
        walletKey
      );

    if (
      !wallet ||
      Object.keys(wallet)
        .length === 0
    ) {
      return res.status(404).json({
        message:
          "Wallet not found"
      });
    }

    const baseAsset =
      symbol.split("/")[0];

    // ====================================
    // 3. LOCK BALANCE
    // ====================================

    if (side === "BUY") {
      const cost = price * qty;

      const availableINR =
        Number(
          wallet.INR_available
        );

      if (
        availableINR < cost
      ) {
        return res.status(400).json({
          message:
            "Insufficient INR"
        });
      }

      await redis.hincrbyfloat(
        walletKey,
        "INR_available",
        -cost
      );

      await redis.hincrbyfloat(
        walletKey,
        "INR_locked",
        cost
      );
    }

    if (side === "SELL") {
      const availableAsset =
        Number(
          wallet[
            `${baseAsset}_available`
          ]
        );

      if (
        availableAsset <
        qty
      ) {
        return res.status(400).json({
          message:
            "Insufficient asset"
        });
      }

      await redis.hincrbyfloat(
        walletKey,
        `${baseAsset}_available`,
        -qty
      );

      await redis.hincrbyfloat(
        walletKey,
        `${baseAsset}_locked`,
        qty
      );
    }

    // ====================================
    // 4. CREATE ORDER IN MONGO
    // ====================================
    const order =
      await Order.create({
        userId,
        symbol,
        side,
        type,
        price,
        qty
      });

    let remainingQty =
      qty;

    // ====================================
    // 5. MATCH FROM REDIS ORDERBOOK
    // ====================================
    const oppositeSide =
      side === "BUY"
        ? "SELL"
        : "BUY";

    const bookKey =
      `orderbook:${symbol}:${oppositeSide}`;

    const orderIds =
      await redis.zrange(
        bookKey,
        0,
        -1
      );

    for (let id of orderIds) {
      if (
        remainingQty <= 0
      )
        break;

      const makerOrder =
        await Order.findById(
          id
        );

      if (!makerOrder)
        continue;

      const makerAvailable =
        makerOrder.qty -
        makerOrder.filledQty;

      const tradeQty =
        Math.min(
          remainingQty,
          makerAvailable
        );

      // create fill
      await Fill.create({
        buyOrderId:
          side === "BUY"
            ? order._id
            : makerOrder._id,

        sellOrderId:
          side === "SELL"
            ? order._id
            : makerOrder._id,

        buyerId:
          side === "BUY"
            ? userId
            : makerOrder.userId,

        sellerId:
          side === "SELL"
            ? userId
            : makerOrder.userId,

        symbol,
        price:
          makerOrder.price,
        qty: tradeQty
      });

      makerOrder.filledQty +=
        tradeQty;

      makerOrder.status =
        makerOrder
          .filledQty ===
        makerOrder.qty
          ? "FILLED"
          : "PARTIALLY_FILLED";

      await makerOrder.save();

      if (
        makerOrder.status ===
        "FILLED"
      ) {
        await redis.zrem(
          bookKey,
          id
        );
      }

      remainingQty -=
        tradeQty;
    }

    // ====================================
    // 6. UPDATE TAKER ORDER
    // ====================================
    order.filledQty =
      qty - remainingQty;

    order.status =
      remainingQty === 0
        ? "FILLED"
        : remainingQty < qty
        ? "PARTIALLY_FILLED"
        : "OPEN";

    await order.save();

    // ====================================
    // 7. ADD TO BOOK
    // ====================================
    if (
      remainingQty > 0 &&
      type === "LIMIT"
    ) {
      const myBook =
        `orderbook:${symbol}:${side}`;

      await redis.zadd(
        myBook,
        price,
        order._id.toString()
      );
    }

    // MARKET leftover cancelled
    if (
      remainingQty > 0 &&
      type === "MARKET"
    ) {
      order.status =
        "CANCELLED";

      await order.save();
    }

    return res.status(201).json({
      message:
        "Order processed",
      order
    });
  } catch (error) {
    return res.status(500).json({
      message:
        error.message
    });
  }
};
