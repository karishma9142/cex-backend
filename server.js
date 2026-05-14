import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors'
import { connectDb } from './config/db.js';
import Router from './routes/authRoutes.js';

dotenv.config();
connectDb();
const app = express();
app.use(express.json());
app.use(cors());

app.use('/api/v1/user' , Router);
const port = process.env.PORT || 3000;
app.listen(port ,() => {
    console.log(`server running on ${port}`)
})