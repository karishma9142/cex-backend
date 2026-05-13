import mongoose from "mongoose";

const StockSchema = new mongoose.Schema({
    title: {
        type : String ,
        required: true
    },

    symbol: {
        type : String ,
        required: true
    }
})

const StockModel = mongoose.model("stock" , StockSchema);

export default StockModel;