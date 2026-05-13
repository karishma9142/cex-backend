import mongoose from "mongoose";

const OrderSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true
    },

    side: {
        type: String,
        enum: ["buy", "sell"],
        required: true
    },

    type: {
        type: String,
        enum: ['limit' , 'market'],
        required: true
    },

    stockId: {
        type: mongoose.Schema.ObjectId,
        required: true
    },

    price: {
        type: Number,
        required: function () {
            return this.type === "limit";
        }
    },

    qty: {
        type: Number,
        required: true
    },

    filledQty: {
        type: Number,
        required: true
    },

    status: {
        type: String,
        enum: [
            "open",
            "partially_filled",
            "filled",
            "cancelled"
        ],
        default: "open"
    }
},{
    timestamps:true
});

const OrderModel = mongoose.model("order" , OrderSchema);

export default OrderModel;