import UserModel from "../models/User.js";

const DOCUMENT_TYPES = ["AADHAAR", "PAN", "PASSPORT", "DRIVING_LICENSE", "VOTER_ID"];

// Fields that require BOTH a front and back image (physical cards).
// Passport only needs the front (photo page).
const REQUIRES_BACK = new Set(["AADHAAR", "DRIVING_LICENSE", "VOTER_ID"]);

function fileUrl(req, file) {
  if (!file) return undefined;
  return `${req.protocol}://${req.get("host")}/uploads/kyc/${file.filename}`;
}

// ─────────────────────────────────────────────
// POST /api/kyc  (multipart/form-data)
// Protected — submit or resubmit KYC documents
// ─────────────────────────────────────────────
export const submitKyc = async (req, res) => {
  try {
    const userId = req.user_id;
    const user = await UserModel.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    if (user.kycStatus === "APPROVED") {
      return res.status(400).json({ message: "KYC already approved" });
    }
    if (user.kycStatus === "PENDING") {
      return res.status(400).json({ message: "A KYC submission is already under review" });
    }

    const { fullName, dob, country, documentType, documentNumber } = req.body;
    const errors = [];

    if (!fullName?.trim())        errors.push("fullName is required");
    if (!dob || isNaN(Date.parse(dob))) errors.push("dob must be a valid date");
    if (!country?.trim())         errors.push("country is required");
    if (!DOCUMENT_TYPES.includes(documentType)) {
      errors.push(`documentType must be one of: ${DOCUMENT_TYPES.join(", ")}`);
    }
    if (!documentNumber?.trim())  errors.push("documentNumber is required");

    const front  = req.files?.documentFront?.[0];
    const back   = req.files?.documentBack?.[0];
    const selfie = req.files?.selfieImage?.[0];

    if (!front)  errors.push("documentFront image is required");
    if (!selfie) errors.push("selfieImage is required");
    if (documentType && REQUIRES_BACK.has(documentType) && !back) {
      errors.push(`documentBack image is required for ${documentType}`);
    }

    if (errors.length > 0) {
      return res.status(400).json({ message: "Validation failed", errors });
    }

    user.kycData = {
      fullName: fullName.trim(),
      dob: new Date(dob),
      country: country.trim(),
      documentType,
      documentNumber: documentNumber.trim(),
      documentFront: fileUrl(req, front),
      documentBack: fileUrl(req, back),
      selfieImage: fileUrl(req, selfie),
      submittedAt: new Date(),
      approvedAt: undefined,
      rejectedReason: undefined,
    };
    user.kycStatus = "PENDING";
    await user.save();

    return res.status(200).json({
      message: "KYC submitted — pending review",
      kycStatus: user.kycStatus,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

// ─────────────────────────────────────────────
// GET /api/kyc/me
// Protected — current user's KYC status + submitted data
// ─────────────────────────────────────────────
export const getMyKyc = async (req, res) => {
  try {
    const user = await UserModel.findById(req.user_id).select("kycStatus kycData").lean();
    if (!user) return res.status(404).json({ message: "User not found" });

    return res.status(200).json({
      kycStatus: user.kycStatus,
      kycData: user.kycData ?? null,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

// ─────────────────────────────────────────────
// GET /api/kyc?status=PENDING&page=1&limit=20
// Admin only — list submissions, defaults to PENDING
// ─────────────────────────────────────────────
export const listKyc = async (req, res) => {
  try {
    const status = req.query.status?.toUpperCase() || "PENDING";
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));

    const filter = { kycStatus: status };
    const [users, total] = await Promise.all([
      UserModel.find(filter)
        .select("fullName userName email kycStatus kycData createdAt")
        .sort({ "kycData.submittedAt": -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      UserModel.countDocuments(filter),
    ]);

    return res.status(200).json({
      users, page, limit, total,
      pages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

// ─────────────────────────────────────────────
// PATCH /api/kyc/:userId   { action: "approve" | "reject", reason? }
// Admin only — approve or reject a pending submission
// ─────────────────────────────────────────────
export const reviewKyc = async (req, res) => {
  try {
    const { userId } = req.params;
    const { action, reason } = req.body;

    if (!["approve", "reject"].includes(action)) {
      return res.status(400).json({ message: "action must be 'approve' or 'reject'" });
    }
    if (action === "reject" && !reason?.trim()) {
      return res.status(400).json({ message: "reason is required when rejecting" });
    }

    const user = await UserModel.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });
    if (user.kycStatus !== "PENDING") {
      return res.status(400).json({ message: `Nothing to review — current status is ${user.kycStatus}` });
    }

    if (action === "approve") {
      user.kycStatus = "APPROVED";
      user.kycData.approvedAt = new Date();
      user.kycData.rejectedReason = undefined;
    } else {
      user.kycStatus = "REJECTED";
      user.kycData.rejectedReason = reason.trim();
    }
    await user.save();

    return res.status(200).json({
      message: `KYC ${action}d`,
      kycStatus: user.kycStatus,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};