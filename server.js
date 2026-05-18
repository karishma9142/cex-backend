import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors'
import { connectDb } from './config/db.js';
import redisClient from './config/redis.js';
import AuthRouter from './routes/authRoutes.js';
import OrderRouter from './routes/orderRoutes.js';
import WalletRouter from './routes/walletRoutes.js';
import { seedRedis } from './utils/seedRedis.js';
import marketRouter from './routes/marketRoutes.js';


dotenv.config();
connectDb();
await seedRedis();

const app = express();
app.use(express.json());
app.use(cors());


app.use('/api/v1/user' , AuthRouter);
app.use('/api/v1/order' , OrderRouter);
app.use('/api/v1/wallet' , WalletRouter);
app.use('/api/v1/market' , marketRouter);


const port = process.env.PORT || 3000;
app.listen(port ,() => {
    console.log(`server running on ${port}`)
})