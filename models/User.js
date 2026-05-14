import mongoose from "mongoose";

const UserSchema = new mongoose.Schema({
      fullName: {
      type: String,
      required: true,
      trim: true,
    },

    userName: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true,

    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

      password: {
      type: String,
      required: true,
    },

    // KYC
    kycStatus: {
      type: String,
      enum: ["PENDING", "APPROVED", "REJECTED", "NOT_SUBMITTED"],
      default: "NOT_SUBMITTED",
    },

    kycData: {
      fullName: String,
      dob: Date,
      country: String,
      documentType: String,
      documentNumber: String,
      documentFront: String,
      documentBack: String,
      selfieImage: String,
      submittedAt: Date,
      approvedAt: Date,
      rejectedReason: String,
    },

     // Wallet Balances
    balances: [
      {
        coin: {
          type: String,
          required: true,
        },

        available: {
          type: Number,
          default: 0,
        },

        locked: {
          type: Number,
          default: 0,
        },
      },
    ],

      // Roles
    role: {
      type: String,
      enum: ["USER", "ADMIN", "SUPPORT"],
      default: "USER",
    },

    // Account Status
    status: {
      type: String,
      enum: ["ACTIVE", "SUSPENDED", "BLOCKED"],
      default: "ACTIVE",
    },

});




const userModel = mongoose.model("user", UserSchema);

export default userModel;