const express = require("express");
const bodyParser = require("body-parser");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const auth = require("./middleware/auth");
const cors = require("cors");
require("dotenv").config();
const getFormattedDate = require("./utility/formattedDate");

const bcrypt = require("bcryptjs");

const app = express();
app.use(bodyParser.json());

// Connect to MongoDB using Mongoose
mongoose.connect("mongodb://127.0.0.1:27017/reel_northeast");
mongoose.connection.on("connected", () => {
  console.log("Connected to MongoDB");
});

// Create a Mongoose schema for the user
const signupSchema = new mongoose.Schema({
  firstName: String,
  lastName: String,
  email: String,
  username: String,
  password: String,
});

const commentSchema = new mongoose.Schema({
  author: String,
  content: String,
  date: String,
  time: { type: Date, default: Date.now },
});

const threadSchema = new mongoose.Schema({
  title: String,
  author: String,
  date: String,
  content: String,
  comments: [commentSchema],
  totalComments: Number,
  totalViews: Number,
  time: { type: Date, default: Date.now },
});

const profileSchema = new mongoose.Schema({
  username: String,
  name: String,
  state: String,
  biography: String,
  profilePicture: String,
  email: String,
  website: String,
  socialMediaLinks: [
    {
      url: String,
      platform: String,
    },
  ],
});

// Create a Mongoose model based on the signupSchema
const User = mongoose.model("User", signupSchema);

const Thread = mongoose.model("Thread", threadSchema);

const Profile = mongoose.model("Profile", profileSchema);

app.use(cors({ origin: process.env.FRONT_END_URL }));
// Define a route to handle user registration
app.post("/signup", async (req, res) => {
  try {
    const { firstName, lastName, email, username, password } = req.body;

    const existingEmail = await User.findOne({ email });
    if (existingEmail) {
      return res.status(409).json({ message: "Email already exists" });
    }

    const existingUsername = await User.findOne({ username });
    if (existingUsername) {
      return res.status(409).json({ message: "Username already exists" });
    }

    bcrypt.genSalt(12, (err, salt) => {
      if (err) throw err;
      bcrypt.hash(password, salt, async (err, hash) => {
        if (err) throw err;

        const newUser = new User({
          firstName,
          lastName,
          email,
          username,
          password: hash,
        });

        // Save the new user to the database
        const savedUser = await newUser.save();

        // Generate a JWT token
        const token = jwt.sign(
          { userId: newUser._id },
          process.env.JWT_SECRET,
          {
            expiresIn: 3600,
          }
        );

        // Return the token and user details to the client
        res.json({ token, user: savedUser });
      });
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "An error occurred" });
  }
});

// Define a route to handle user authentication
app.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    // Check if the user exists in the database
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(401).json({ message: "Invalid username or password" });
    }

    // Check if the password is correct
    if (password !== user.password) {
      return res.status(401).json({ message: "Invalid username or password" });
    }

    // Generate a JWT token
    const token = jwt.sign(
      { userId: user._id, username },
      process.env.JWT_SECRET
    );

    // Return the token to the client
    res.json({ token });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "An error occurred" });
  }
});

app.post("/forum", auth, async (req, res) => {
  try {
    const { title, content } = req.body;
    const author = req.user.username;

    const newThread = new Thread({
      title,
      author,
      content,
      date: getFormattedDate(),
      totalComments: 0,
      totalViews: 0,
    });

    await newThread.save();

    res.status(201).json(newThread);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "An error occurred" });
  }
});

app.post("/forum/:id/comments", auth, async (req, res) => {
  try {
    const { id } = req.params;
    const { author, content } = req.body;

    const thread = await Thread.findById(id);
    if (!thread) {
      return res.status(404).json({ message: "Thread not found" });
    }

    const newComment = {
      author,
      content,
      date: getFormattedDate(),
    };

    await Thread.updateOne(
      { _id: id },
      { $push: { comments: newComment }, $inc: { totalComments: 1 } }
    );

    res.status(201).json(thread);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "An error occurred" });
  }
});

app.put("/profile/:id", auth, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      username,
      name,
      state,
      biography,
      email,
      website,
      socialMediaLinks,
    } = req.body;

    // Check if the user is authorized to update the profile
    if (req.user.username !== username) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const updatedProfile = {
      username,
      name,
      state,
      biography,
      email,
      website,
      socialMediaLinks,
    };

    // Find the profile by ID and update it
    const profile = await Profile.findByIdAndUpdate(id, updatedProfile, {
      new: true,
    });

    if (!profile) {
      return res.status(404).json({ message: "Profile not found" });
    }

    res.status(200).json(profile);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "An error occurred" });
  }
});

app.get("/forum/threads", async (req, res) => {
  const foundThreads = await Thread.find({});
  res.json(foundThreads);
});

app.get("/forum/:threadId", async (req, res) => {
  try {
    const { threadId } = req.params;

    const thread = await Thread.findById(threadId);
    if (!thread) {
      return res.status(404).json({ message: "Thread not found" });
    }

    res.status(200).json(thread.comments);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "An error occurred" });
  }
});

app.get("/protected", auth, (req, res) => {
  res.json({ message: "Protected route accessed successfully" });
});

app.listen(5000, () => {
  console.log("Server is running on http://localhost:5000");
});
