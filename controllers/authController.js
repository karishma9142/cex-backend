import { email, z } from 'zod'
import userModel from '../models/User.js';
import bcrypt from 'bcrypt';
import crypto from "crypto";
import jwt from 'jsonwebtoken';
const salt = 10;


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
        const token = jwt.sign({ user_id: newUser._id }, process.env.JWT_SECRET);
        console.log(token);
        return res.status(200).json({
            msg: "user created",
            token: token,
            username: newUser.userName
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

        const findUser = await userModel.findOne({email : email});
        if (!findUser) {
            return res.status(401).json({
                msg: "user does not exist signup up first please"
            })
        }
        // console.log(password);
        // console.log(findUser.password)
        const cheakPassword = await bcrypt.compare(password , findUser.password);
        if(!cheakPassword){
            return res.status(401).json({
                msg: "wrong password"
            })
        }
        const token = jwt.sign({
            user_id: findUser._id
        }, process.env.JWT_SECRET);

        console.log(token);
        return res.status(200).json({
            msg : "sign in sucessfully" ,
            token : token
        })

    } catch (error) {
        console.log(error.message);
        res.status(500).json({
            msg : "internal server error"
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