import UserModel from "../models/User.js";

// Runs AFTER authMiddleware (which sets req.userId)
export const adminMiddleware = async (req, res, next) => {
  try {
    const user = await UserModel.findById(req.user_id).lean();

    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }

    if (user.role != "ADMIN") {
      return res.status(403).json({ message: "Admin access required" });
    }

    next();
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};