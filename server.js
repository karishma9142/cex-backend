import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors'
import { connectDb } from './config/db.js';
import redisClient from './config/redis.js';
import AuthRouter from './routes/authRoutes.js';
import OrderRouter from './routes/orderRoutes.js';

dotenv.config();
connectDb();

const app = express();
app.use(express.json());
app.use(cors());


app.use('/api/v1/user' , AuthRouterRouter);
app.use('/api/v1/order' , OrderRouter)
const port = process.env.PORT || 3000;
app.listen(port ,() => {
    console.log(`server running on ${port}`)
})