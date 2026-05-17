import express from 'express';
import { placeOrder } from '../controllers/orderController.js';

const OrderRouter = express.Router();

OrderRouter.post('/' , placeOrder);

export default OrderRouter;