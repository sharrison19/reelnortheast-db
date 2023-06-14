const jwt = require("jsonwebtoken");

function auth(req, res, next) {
  let token = req.header("Authorization");
  if (!token) {
    return res.status(401).json({
      message: "No token located at Authorization header, authorization denied",
    });
  }
  try {
    token = token.split("Bearer ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    res.status(400).json({
      message: "Token could not be verified",
    });
  }
}

module.exports = auth;
