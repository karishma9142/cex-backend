import express from 'express';
import { Profile, Signin, Signup } from '../controllers/authController.js';
import { Auth } from '../middleware/auth.js';

const AuthRouter = express.Router();

AuthRouter.post('/signup' , Signup);
AuthRouter.post('/signin' , Signin);
AuthRouter.get('/me' ,Auth , Profile)

export default AuthRouter;