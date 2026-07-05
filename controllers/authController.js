import { email, z } from 'zod'
import userModel from '../models/User.js';
import bcrypt from 'bcrypt';
import crypto from "crypto";
import jwt from 'jsonwebtoken';
import redis from '../config/redis.js';
import WalletModel from '../models/Wallet.js';
const salt = 10;

const SUPPORTED_ASSETS = ["INR", "BTC", "ETH", "SOL"];

export const userSchema = z.object({
    fullName: z.string({
        required_error: "First name is required"
    }).min(3, "First name must contain at least 3 characters"),


    email: z.string({
        required_error: "Username is required"
    })
        .email('Invalid email formate')
        .min(5, "Username must contain at least 5 characters")
        .max(50, "Username can have max 50 characters"),

    password: z.string({
        required_error: "Password is required"
    })
        .regex(/[A-Z]/, "Must contain at least one uppercase letter")
        .regex(/[0-9]/, "Must contain at least one number")
        .min(5, "Password must contain at least 5 characters")
        .max(50, "Password can have max 50 characters")
});


export const Signup = async (req, res) => {
    try {
        const result = userSchema.safeParse(req.body);
        if (!result.success) {
            return res.status(400).json({
                msg: result.error
            })
        }
        const { fullName, email, password } = result.data;
        // console.log(fullName);
        // console.log(email);
        // console.log(password)
        const foundUser = await userModel.findOne({ email: email });
        if (foundUser) {
            return res.status(409).json({
                msg: 'user with same username is already exist'
            })
        }

        const hashedPassword = await bcrypt.hash(password, salt);
        let userName;
        let exists = true;
        const baseName = email.split("@")[0];
        const randomNumber = Math.floor(1000 + Math.random() * 9000);
        while (exists) {
            const randomNumber = Math.floor(1000 + Math.random() * 9000);
            userName = `${baseName}_${randomNumber}`;

            const user = await userModel.findOne({ userName });
            exists = !!user;
        }

        result.data.password = hashedPassword;
        result.data.userName = userName

        const newUser = await userModel.create(result.data);

        // ── Create wallet in MongoDB ──────────────
        const wallet = await WalletModel.create({ userId: newUser._id });

        // ── Mirror wallet to Redis ────────────────
        const redisKey = `wallet:${newUser._id}`;
        const fields = {};
        for (const asset of SUPPORTED_ASSETS) {
            fields[`${asset}_available`] = "0";
            fields[`${asset}_locked`] = "0";
        }
        await redis.hset(redisKey, fields);
        // ─────────────────────────────────────────



        const token = jwt.sign({ user_id: newUser._id }, process.env.JWT_SECRET, { expiresIn: "7d" });
        return res.status(200).json({
            msg: "user created",
            token: token,
            username: newUser.userName,
            user: {
                id: newUser._id,
                fullName: newUser.fullName,
                userName: newUser.userName,
                email: newUser.email,
                role: newUser.role,
            }
        })

    } catch (error) {
        console.log(error);
        return res.status(500).json({
            msg: "internal server error",
        })
    }
}

export const Signin = async (req, res) => {
    try {
        const { email, password } = req.body;

        const findUser = await userModel.findOne({ email: email });
        if (!findUser) {
            return res.status(401).json({
                msg: "user does not exist signup up first please"
            })
        }
        // console.log(password);
        // console.log(findUser.password)
        const cheakPassword = await bcrypt.compare(password, findUser.password);
        if (!cheakPassword) {
            return res.status(401).json({
                msg: "wrong password"
            })
        }

        // ── Rebuild Redis wallet if missing ───────
        // Handles case where Redis was flushed while user was logged out
        const redisKey = `wallet:${findUser._id}`;
        const walletExists = await redis.exists(redisKey);
        if (!walletExists) {
            const walletDoc = await WalletModel.findOne({ userId: findUser._id });
            if (walletDoc) {
                const fields = {};
                for (const asset of SUPPORTED_ASSETS) {
                    const bal = walletDoc.balances[asset] ?? { available: 0, locked: 0 };
                    fields[`${asset}_available`] = String(bal.available);
                    fields[`${asset}_locked`] = String(bal.locked);
                }
                await redis.hset(redisKey, fields);
            }
        }
        // ─────────────────────────────────────────

        const token = jwt.sign({
            user_id: findUser._id
        }, process.env.JWT_SECRET, { expiresIn: "7d" });

        return res.status(200).json({
            msg: "sign in sucessfully",
            token: token,
            user: {
                id: findUser._id,
                fullName: findUser.fullName,
                userName: findUser.userName,
                email: findUser.email,
                role: findUser.role,
            }
        })

    } catch (error) {
        console.log(error.message);
        res.status(500).json({
            msg: "internal server error"
        })
    }
}

export const Profile = async (req, res) => {
    try {
        const userId = req.user_id;
        const foundUser = await userModel.findById(userId).select("-password");;

        if (!foundUser) {
            return res.status(404).json({
                msg: "User does not exist"
            });
        }

        return res.status(200).json({
            data: foundUser
        });

    } catch (error) {
        console.log(error.message);

        return res.status(500).json({
            msg: "Internal server error"
        });
    }
};