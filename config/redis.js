import Redis from "ioredis";
import dotenv from 'dotenv';

dotenv.config();

const redis = new Redis(process.env.REDIS_URI);
console.log("redis working")




export default redis;