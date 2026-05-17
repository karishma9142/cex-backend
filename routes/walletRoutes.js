import express from 'express';
import {
  createWallet,
  getWallet,
  deposit,
  withdraw,
} from "../controllers/walletController.js";
import { Auth } from "../middleware/auth.js";

const WalletRouter = express.Router();

// Public — called right after register (no token yet in some flows)
WalletRouter.post("/create", createWallet);

// Protected — user must be logged in
WalletRouter.get("/",        Auth, getWallet);
WalletRouter.post("/deposit",  Auth, deposit);
WalletRouter.post("/withdraw", Auth, withdraw);

export default WalletRouter;