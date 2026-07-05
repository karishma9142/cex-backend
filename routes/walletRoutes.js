import express from "express";
import {
  createWallet,
  getWallet,
  deposit,
  withdraw,
  getTransactions,
} from "../controllers/walletController.js";
import { Auth } from "../middleware/auth.js";

const walletRouter = express.Router();

walletRouter.post("/create",          Auth, createWallet);   // called after register
walletRouter.get("/",                 Auth, getWallet);       // view balances
walletRouter.post("/deposit",         Auth, deposit);         // add funds
walletRouter.post("/withdraw",        Auth, withdraw);        // remove funds
walletRouter.get("/transactions",     Auth, getTransactions); // history

export default walletRouter;