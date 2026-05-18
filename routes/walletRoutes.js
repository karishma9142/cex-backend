import express from "express";
import {
  createWallet,
  getWallet,
  deposit,
  withdraw,
  getTransactions,
} from "../controllers/walletController.js";
import { authMiddleware } from "../middleware/auth.js";

const router = express.Router();

router.post("/create",          createWallet);                    // called after register
router.get("/",                 authMiddleware, getWallet);       // view balances
router.post("/deposit",         authMiddleware, deposit);         // add funds
router.post("/withdraw",        authMiddleware, withdraw);        // remove funds
router.get("/transactions",     authMiddleware, getTransactions); // history

export default router;