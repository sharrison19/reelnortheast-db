const jwt = require("jsonwebtoken");
const multer = require("multer");

// Set up Multer storage
const storage = multer.diskStorage({
  destination: function(req, file, cb) {
    // Set the destination folder for uploaded files
    cb(null, "uploads/");
  },
  filename: function(req, file, cb) {
    // Set the filename for uploaded files
    cb(null, Date.now() + "-" + file.originalname);
  },
});

// Create Multer instance
const upload = multer({ storage: storage });

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
    const newToken = jwt.sign(
      { userId: decoded.userId, username: decoded.username },
      process.env.JWT_SECRET,
      { expiresIn: 3600 }
    );
    res.set("token", newToken);

    // Call the Multer middleware to handle file uploads
    upload.single("file")(req, res, function(err) {
      if (err instanceof multer.MulterError) {
        // A Multer error occurred while uploading
        return res.status(400).json({
          message: "Error uploading file",
        });
      } else if (err) {
        // An unknown error occurred
        return res.status(500).json({
          message: "Internal server error",
        });
      }

      // No error occurred, proceed to the next middleware
      next();
    });
  } catch (err) {
    res.status(400).json({
      message: "Token could not be verified",
    });
  }
}

module.exports = auth;
