import mongoose from "mongoose";

const FillSchema = new mongoose.Schema({
    stockId: {
        type: mongoose.Schema.ObjectId,
        required: true
    },

    price: {
        type: Number,
        required: true
    },

    qty: {
        type: Number,
        required: true
    },

    buyOrderId: {
        type: mongoose.Schema.ObjectId,
        required: true
    },

    sellOrderId: {
        type: mongoose.Schema.ObjectId,
        required: true
    }
})


const FillModel = mongoose.model("fill" , FillSchema);

export default FillModel;