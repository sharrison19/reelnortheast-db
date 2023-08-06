const express = require("express");
const bodyParser = require("body-parser");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const auth = require("./middleware/auth");
const cors = require("cors");
require("dotenv").config();
const getFormattedDate = require("./utility/formattedDate");
const cloudinary = require("cloudinary").v2;
const path = require("path");

cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.API_KEY,
  api_secret: process.env.API_SECRET,
  secure: true,
});

const bcrypt = require("bcryptjs");

const publicPath = path.join(__dirname, "./public");

const app = express();
app.use(bodyParser.json());
app.use(express.static(publicPath));

const databaseURL = process.env.MONGO_URL
  ? process.env.MONGO_URL
  : process.env.MONGO_LOCAL_URL;
try {
  if (process.env.MONGO_URL) {
    const fixieData = process.env.FIXIE_SOCKS_HOST.split(
      new RegExp("[/(:\\/@/]+")
    );

    mongoose.connect(process.env.MONGO_URL, {
      proxyUsername: fixieData[0],
      proxyPassword: fixieData[1],
      proxyHost: fixieData[2],
      proxyPort: parseInt(fixieData[3]),
    });
  } else {
    mongoose.connect(process.env.MONGO_LOCAL_URL);
  }
} catch (error) {
  console.log(error);
}
mongoose.connection.on("connected", () => {
  console.log("Connected to MongoDB");
});

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

commentSchema.add({ replies: [commentSchema] });

const threadSchema = new mongoose.Schema({
  title: String,
  author: String,
  date: String,
  content: String,
  comments: [commentSchema],
  totalComments: Number,
  totalViews: { type: Number, default: 0 },
  views: [String],
  categories: [String],
  time: { type: Date, default: Date.now },
});

const profileSchema = new mongoose.Schema({
  username: { type: String, immutable: true, unique: true },
  name: String,
  state: String,
  biography: String,
  profilePicture: String,
  email: { type: String, immutable: true, unique: true },
  userId: String,
  facebook: String,
  twitter: String,
  instagram: String,
  youtube: String,
});

const User = mongoose.model("User", signupSchema);
const Thread = mongoose.model("Thread", threadSchema);
const Profile = mongoose.model("Profile", profileSchema);

app.use(cors({ origin: process.env.FRONT_END_URL, exposedHeaders: "token" }));

app.post("/signup", (req, res) => {
  try {
    const { firstName, lastName, email, username, password } = req.body;

    const userEmailPromise = User.findOne({ email });

    const userUsernamePromise = User.findOne({ username });
    Promise.all([userEmailPromise, userUsernamePromise]).then((responses) => {
      const existingEmail = responses[0];
      if (existingEmail) {
        return res.status(409).json({ message: "Email already exists" });
      }
      const existingUsername = responses[1];
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

          const savedUser = await newUser.save();

          const newProfile = new Profile({
            username,
            name: `${firstName} ${lastName}`,
            state: "",
            biography: "",
            profilePicture:
              "https://res.cloudinary.com/reel-northeast-cloud/image/upload/v1687216166/defaultprofilepicture.jpg",
            email,
            userId: newUser._id,
          });

          const profilePromise = newProfile.save();
          const token = jwt.sign(
            { userId: newUser._id, username },
            process.env.JWT_SECRET,
            {
              expiresIn: 3600,
            }
          );

          res.status(201).json({ token, user: savedUser });
        });
      });
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "An error occurred" });
  }
});

app.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    const user = await User.findOne({ username });
    if (!user) {
      return res.status(401).json({ message: "Invalid username or password" });
    }

    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      return res.status(401).json({ message: "Invalid username or password" });
    }

    const token = jwt.sign(
      { userId: user._id, username },
      process.env.JWT_SECRET,
      { expiresIn: 3600 }
    );

    res.json({ token });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "An error occurred" });
  }
});

app.post("/logout", (req, res) => {
  res.clearCookie("token");
  res.sendStatus(200);
});

app.post("/forum", auth, async (req, res) => {
  try {
    const { title, content, categories } = req.body;
    const author = req.user.username;

    const newThread = new Thread({
      title,
      author,
      content,
      categories,
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
    const { content } = req.body;

    const author = req.user.username;

    const thread = await Thread.findById(id);
    if (!thread) {
      return res.status(404).json({ message: "Thread not found" });
    }

    const newComment = {
      author,
      content,
      date: getFormattedDate(),
      replies: [],
    };

    const newThread = await Thread.findOneAndUpdate(
      { _id: id },
      { $push: { comments: newComment }, $inc: { totalComments: 1 } },
      { new: true }
    );

    res.status(201).json(newThread);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "An error occurred" });
  }
});

app.post("/forum/:id/comments/:commentId/reply", auth, async (req, res) => {
  try {
    const { id, commentId } = req.params;
    const { content } = req.body;
    const author = req.user.username;

    const thread = await Thread.findById(id);
    if (!thread) {
      return res.status(404).json({ message: "Thread not found" });
    }

    const newComment = {
      author,
      content,
      date: getFormattedDate(),
      _id: new mongoose.Types.ObjectId(),
    };

    const updateCommentAndPush = (comments) => {
      for (let i = 0; i < comments.length; i++) {
        const comment = comments[i];
        if (comment._id.toString() === commentId) {
          comment.replies.push(newComment);
          return true;
        }
        if (comment.replies.length > 0) {
          const updated = updateCommentAndPush(comment.replies);
          if (updated) return true;
        }
      }
      return false;
    };

    const commentUpdated = updateCommentAndPush(thread.comments);
    if (!commentUpdated) {
      return res.status(404).json({ message: "Comment not found" });
    }

    thread.totalComments += 1;

    await thread.save();

    res.status(201).json(thread);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "An error occurred" });
  }
});

app.put("/user-profile", auth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const {
      username,
      name,
      state,
      biography,
      email,
      website,
      socialMediaLinks,
      profilePicture,
    } = req.body;

    if (!username || !name || !email) {
      return res.status(400).json({ message: "Required fields are missing" });
    }

    const facebook = socialMediaLinks.filter(
      (link) => link.platform === "facebook"
    );
    const twitter = socialMediaLinks.filter(
      (link) => link.platform === "twitter"
    );
    const instagram = socialMediaLinks.filter(
      (link) => link.platform === "instagram"
    );
    const youtube = socialMediaLinks.filter(
      (link) => link.platform === "youtube"
    );
    const updatedProfile = {
      username,
      name,
      state,
      biography,
      email,
      website,
      facebook: facebook.length > 0 ? facebook[0].url : "",
      twitter: twitter.length > 0 ? twitter[0].url : "",
      instagram: instagram.length > 0 ? instagram[0].url : "",
      youtube: youtube.length > 0 ? youtube[0].url : "",
      profilePicture,
    };

    const profile = await Profile.findOneAndUpdate({ userId }, updatedProfile, {
      new: true,
    });

    if (!profile) {
      return res.status(404).json({ message: "Profile not found" });
    }

    res
      .status(200)
      .json({ success: true, message: "Profile updated successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "An error occurred" });
  }
});

app.put("/forum/:threadId/views", async (req, res) => {
  try {
    const { threadId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(threadId)) {
      return res.status(400).json({ message: "Invalid threadId" });
    }

    const updatedThread = await Thread.findByIdAndUpdate(
      threadId,
      { $inc: { totalViews: 1 } },
      { new: true }
    );

    if (!updatedThread) {
      return res.status(404).json({ message: "Thread not found" });
    }

    res.sendStatus(200);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "An internal server error occurred" });
  }
});

app.put("/forum/:id/comments/:commentId", auth, async (req, res) => {
  try {
    const { id, commentId } = req.params;
    const { content } = req.body;

    const thread = await Thread.findById(id);
    if (!thread) {
      return res.status(404).json({ message: "Thread not found" });
    }
    const updateCommentWithEdit = (comments) => {
      for (let i = 0; i < comments.length; i++) {
        const comment = comments[i];
        if (comment._id.toString() === commentId) {
          if (comment.author !== req.user.username) {
            return res.status(403).json({ message: "Unauthorized" });
          }

          if (content) {
            comment.content = content;
          }

          return true;
        }
        if (comment.replies.length > 0) {
          const updated = updateCommentWithEdit(comment.replies);
          if (updated) return true;
        }
      }
      return false;
    };

    const commentUpdated = updateCommentWithEdit(thread.comments);
    if (!commentUpdated) {
      return res.status(404).json({ message: "Comment not found" });
    }

    await thread.save();

    res.status(200).json(thread);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "An error occurred" });
  }
});

app.delete("/forum/:id/comments/:commentId", auth, async (req, res) => {
  try {
    const { id, commentId } = req.params;

    const thread = await Thread.findById(id);
    if (!thread) {
      return res.status(404).json({ message: "Thread not found" });
    }

    const updateCommentWithDeleted = (comments) => {
      for (let i = 0; i < comments.length; i++) {
        const comment = comments[i];
        if (comment._id.toString() === commentId) {
          if (comment.author !== req.user.username) {
            return res.status(403).json({ message: "Unauthorized" });
          }

          comment.author = "";

          comment.content = "Comment was deleted";

          return true;
        }
        if (comment.replies.length > 0) {
          const updated = updateCommentWithDeleted(comment.replies);
          if (updated) return true;
        }
      }
      return false;
    };

    const commentUpdated = updateCommentWithDeleted(thread.comments);
    if (!commentUpdated) {
      return res.status(404).json({ message: "Comment not found" });
    }

    await thread.save();

    res.status(200).json(thread);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "An error occurred" });
  }
});

app.get("/forum/threads", async (req, res) => {
  try {
    const foundThreads = await Thread.find(
      {},
      "_id title author content date totalComments totalViews categories time"
    );
    res.json(foundThreads);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "An internal server error occurred" });
  }
});

app.get("/forum/:threadId", async (req, res) => {
  try {
    const { threadId } = req.params;

    if (!threadId) {
      return res.status(400).json({ message: "Invalid threadId" });
    }

    const thread = await Thread.findById(threadId);
    if (!thread) {
      return res.status(404).json({ message: "Thread not found" });
    }

    res.status(200).json(thread);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "An internal server error occurred" });
  }
});

app.get("/user-profile", auth, async (req, res) => {
  try {
    const userId = req.user.userId;

    if (!userId) {
      return res.status(400).json({ message: "Invalid Profile Id" });
    }

    let profile = await Profile.findOne({ userId })
      .lean()
      .exec();

    if (!profile) {
      return res.status(404).json({ message: "Profile not found" });
    }

    profile = {
      ...profile,
      socialMediaLinks: [
        { platform: "facebook", url: profile.facebook },
        { platform: "twitter", url: profile.twitter },
        { platform: "instagram", url: profile.instagram },
        { platform: "youtube", url: profile.youtube },
      ],
    };

    delete profile.twitter;
    delete profile.facebook;
    delete profile.instagram;
    delete profile.youtube;

    res.status(200).json(profile);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "An internal server error occurred" });
  }
});

app.get("/user-profile/:username", async (req, res) => {
  try {
    const username = req.params.username;

    let profile = await Profile.findOne({ username })
      .lean()
      .exec();

    if (!profile) {
      return res.status(404).json({ message: "Profile not found" });
    }

    profile = {
      ...profile,
      socialMediaLinks: [
        { platform: "facebook", url: profile.facebook },
        { platform: "twitter", url: profile.twitter },
        { platform: "instagram", url: profile.instagram },
        { platform: "youtube", url: profile.youtube },
      ],
    };

    delete profile.twitter;
    delete profile.facebook;
    delete profile.instagram;
    delete profile.youtube;

    res.status(200).json(profile);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "An internal server error occurred" });
  }
});

app.get("/forum/search/:searchQuery", (req, res) => {
  const searchQuery = req.params.searchQuery;

  if (!searchQuery || searchQuery.trim() === "") {
    return res.status(400).json({ message: "Invalid search query" });
  }

  const criteria = {
    $or: [
      { title: { $regex: searchQuery, $options: "i" } },
      { content: { $regex: searchQuery, $options: "i" } },
      { author: { $regex: searchQuery, $options: "i" } },
    ],
  };

  Thread.find(criteria)
    .then((searchResults) => {
      res.json(searchResults);
    })
    .catch((error) => {
      console.error(error);
      res.status(500).json({ error: "An error occurred during the search." });
    });
});

app.get("/protected", auth, (req, res) => {
  res.json({ message: "Protected route accessed successfully" });
});

app.get("/*", (req, res) => {
  res.sendFile(publicPath + "/index.html", (error) => {
    if (error) {
      res.status(500).send(error);
    }
  });
});

app.listen(process.env.PORT || 5000, () => {
  console.log("Server is running on http://localhost:5000");
});
