const express = require("express");
const bcrypt = require("bcrypt");
const bodyParser = require("body-parser");
const cors = require("cors");
const mongoose = require("mongoose");

const jwt = require("jsonwebtoken");

const verifyToken = (req, res, next) => {
  const token = req.headers.authorization;

  if (!token) {
    return res.status(401).json({ error: "No token provided" });
  }

  jwt.verify(token, "secret_key", (err, decoded) => {
    if (err) {
      return res.status(401).json({ error: "Invalid token" });
    }
    req.user = decoded;
    next();
  });
};

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(bodyParser.json());
app.use(cors());

// Connect to MongoDB
mongoose
  .connect("mongodb://localhost:27017/myapp")
  .then(() => console.log("Connected to MongoDB"))
  .catch((err) => console.error("Error connecting to MongoDB", err));

app.post("/api/users", async (req, res) => {
  try {
    const { name, email, password, image } = req.body;
    // Check if the email already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: "Email already exists" });
    }
    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);
    // Create a new user
    const newUser = new User({
      name,
      email,
      password: hashedPassword,
      image,
    });
    // Save the user to the database
    await newUser.save();
    res.status(201).json({ message: "User created successfully" });
  } catch (error) {
    console.error("Error registering user:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});
app.get("/api/users/:id", async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    res.json(user);
  } catch (error) {
    console.error("Error fetching user:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});
app.put("/api/users/:id", async (req, res) => {
  try {
    const { name, email, image } = req.body;
    const updatedUser = await User.findByIdAndUpdate(
      req.params.id,
      { name, email, image },
      { new: true }
    );
    if (!updatedUser) {
      return res.status(404).json({ error: "User not found" });
    }
    res.json({ message: "User updated successfully", user: updatedUser });
  } catch (error) {
    console.error("Error updating user:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});
app.delete("/api/users/:id", async (req, res) => {
  try {
    const deletedUser = await User.findByIdAndDelete(req.params.id);
    if (!deletedUser) {
      return res.status(404).json({ error: "User not found" });
    }
    res.json({ message: "User deleted successfully" });
  } catch (error) {
    console.error("Error deleting user:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});
app.get("/api/users/:id/posts", verifyToken, async (req, res) => {
  try {
    // Access user information from req.user
    const userEmail = req.user.email;

    // Check if the requested user is the same as the authenticated user
    if (req.params.id !== req.user.id) {
      return res.status(403).json({ error: "Unauthorized access" });
    }

    // Fetch posts belonging to the user with the specified ID
    const posts = await Post.find({ user: req.params.id }).sort({ date: -1 });

    res.json(posts);
  } catch (error) {
    console.error("Error fetching posts:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});
app.post("/api/users/:id/posts", verifyToken, async (req, res) => {
  try {
    // Access user information from req.user
    const userEmail = req.user.email;

    // Check if the requested user is the same as the authenticated user
    if (req.params.id !== req.user.id) {
      return res.status(403).json({ error: "Unauthorized access" });
    }

    // Extract post data from the request body
    const { message } = req.body;

    // Create a new post
    const newPost = new Post({
      user: req.params.id,
      message,
    });

    // Save the new post to the database
    await newPost.save();

    res
      .status(201)
      .json({ message: "Post created successfully", post: newPost });
  } catch (error) {
    console.error("Error creating post:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});
app.put("/api/users/:id/posts/:pid", verifyToken, async (req, res) => {
  try {
    // Access user information from req.user
    const userEmail = req.user.email;

    // Check if the requested user is the same as the authenticated user
    if (req.params.id !== req.user.id) {
      return res.status(403).json({ error: "Unauthorized access" });
    }

    // Extract updated post data from the request body
    const { message } = req.body;

    // Find the post by ID and update it
    const updatedPost = await Post.findByIdAndUpdate(
      req.params.pid,
      { message },
      { new: true }
    );

    // Check if the post exists
    if (!updatedPost) {
      return res.status(404).json({ error: "Post not found" });
    }

    res.json({ message: "Post updated successfully", post: updatedPost });
  } catch (error) {
    console.error("Error updating post:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});
app.delete("/api/users/:id/posts/:pid", verifyToken, async (req, res) => {
  try {
    // Access user information from req.user
    const userEmail = req.user.email;

    // Check if the requested user is the same as the authenticated user
    if (req.params.id !== req.user.id) {
      return res.status(403).json({ error: "Unauthorized access" });
    }

    // Find the post by ID and delete it
    const deletedPost = await Post.findByIdAndDelete(req.params.pid);

    // Check if the post exists
    if (!deletedPost) {
      return res.status(404).json({ error: "Post not found" });
    }

    res.json({ message: "Post deleted successfully", post: deletedPost });
  } catch (error) {
    console.error("Error deleting post:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});


app.get("/api/posts", verifyToken, async (req, res) => {
  try {
    // Access user information from req.user
    const userEmail = req.user.email;
    // Logic to fetch user's feed based on friends
    const posts = await Post.find({ user: { $in: user.friends } })
      .sort({ date: -1 })
      .limit(20);
    // Additional logic to fetch posts of non-friends
    const nonFriendPosts = await Post.find({ user: { $nin: user.friends } })
      .sort({ date: -1 })
      .limit(5);

    res.json({ posts: [...posts, ...nonFriendPosts] });
  } catch (error) {
    console.error("Error fetching posts:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});
app.post("/api/tokens", async (req, res) => {
  try {
    const { email, password } = req.body;
    // Check if the user exists
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    // Verify the password
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: "Invalid password" });
    }
    // Generate JWT token
    const token = jwt.sign({ email: user.email }, "secret_key");
    res.json({ token });
  } catch (error) {
    console.error("Error generating token:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});
// Register route
app.post("/api/register", async (req, res) => {
  try {
    console.log("Registering user");
    const { name, email, password, image } = req.body;
    // Check if the email already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: "Email already exists" });
    }
    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);
    // Create a new user
    const newUser = new User({
      name,
      email,
      password: hashedPassword,
      image,
    });
    // Save the user to the database
    await newUser.save();
    res.status(201).json({ message: "User created successfully" });
  } catch (error) {
    console.error("Error registering user:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Login route
app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    // Check if the user exists
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    // Verify the password
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: "Invalid password" });
    }
    // Generate JWT token
    const token = jwt.sign({ email: user.email }, "secret_key");
    res.json({ token });
  } catch (error) {
    console.error("Error generating token:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
