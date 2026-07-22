import express from "express";
import {
  submitKyc, getMyKyc, listKyc, reviewKyc,
} from "../controllers/kycController.js";
import { Auth }            from "../middleware/auth.js";
import { adminMiddleware } from "../middleware/admin.js";
import { kycUpload }       from "../middleware/upload.js";

const router = express.Router();

// ── User ──────────────────────────────────────────────────────
router.post(
  "/",
  Auth,
  kycUpload.fields([
    { name: "documentFront", maxCount: 1 },
    { name: "documentBack",  maxCount: 1 },
    { name: "selfieImage",   maxCount: 1 },
  ]),
  submitKyc
);
router.get("/me", Auth, getMyKyc);

// ── Admin ─────────────────────────────────────────────────────
router.get("/",              Auth, adminMiddleware, listKyc);
router.patch("/:userId",     Auth, adminMiddleware, reviewKyc);

export default router;