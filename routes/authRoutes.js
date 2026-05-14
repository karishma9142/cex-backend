import express from 'express';
import { Profile, Signin, Signup } from '../controllers/authController.js';
import { Auth } from '../middleware/auth.js';

const Router = express.Router();

Router.post('/signup' , Signup);
Router.post('/signin' , Signin);
Router.get('/me' ,Auth , Profile)

export default Router;