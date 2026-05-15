import express from 'express';
import { Order } from '../controllers/orderController.js';

const OrderRouter = express.Router();

OrderRouter.post('/' , Order);

export default OrderRouter;