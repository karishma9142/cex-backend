import jwt from "jsonwebtoken";

export const Auth = async (req , res,next) => {
    try {
    const token = req.headers.authorization;
    if (!token) {
      return res.status(401).json({
        msg: "No token provided"
      });
    }
 
    console.log(token)

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log(decoded)
    req.user_id = decoded.user_id;

    next();

  } catch (error) {
    console.log(error.message);

    return res.status(401).json({
      msg: "Invalid token"
    });
  }
}