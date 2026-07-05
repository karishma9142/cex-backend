import jwt from "jsonwebtoken";

export const Auth = async (req , res,next) => {
    try {
    const header = req.headers.authorization;
    if (!header) {
      return res.status(401).json({
        msg: "No token provided"
      });
    }

    // Accept both "Bearer <token>" (standard) and a raw token
    const token = header.startsWith("Bearer ") ? header.slice(7) : header;

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user_id = decoded.user_id;

    next();

  } catch (error) {
    console.log(error.message);

    return res.status(401).json({
      msg: "Invalid token"
    });
  }
}