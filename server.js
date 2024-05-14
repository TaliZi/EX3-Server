const express = require("express");
const bcrypt = require("bcrypt");
const bodyParser = require("body-parser");
const cors = require("cors");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const net = require("net");

const { jwtDecode } = require("jwt-decode");
const { Post, User } = require("./models");

require('dotenv').config();

const verifyToken = (req, res, next) => {
  const token = req.headers.authorization;

  if (!token) {
    return res.status(401).json({ error: "No token provided" });
  }

  const tokenString = token.replace("Bearer ", ""); // Remove "Bearer " from the token

  const decoded = jwtDecode(tokenString);

  if (!decoded) {
    console.error("Error verifying token:", err); // Log the error
    return res.status(401).json({ error: "Invalid token" });
  }
  next();
};

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(bodyParser.json({ limit: "50mb" }));
app.use(bodyParser.urlencoded({ limit: "50mb", extended: true }));
app.use(bodyParser.json());
app.use(cors());

// Connect to MongoDB
mongoose
  .connect("mongodb://localhost:27017/myapp")
  .then(() => console.log("Connected to MongoDB"))
  .catch((err) => console.error("Error connecting to MongoDB", err));

// Create bloom filter client instance and establish connection
const bloomFilterClient = net.createConnection({ 
  host: process.env.BLOOM_FILTER_HOSTNAME, 
  port: process.env.BLOOM_FILTER_PORT
});
bloomFilterClient.on('connect', async () => {
    console.log('Connected to bloom-filter server');
    await sendMessageToBloomFilter(process.env.BLOOM_FILTER_CONFIG);
    const blocklist = process.env.BLOCKLIST.split(';');
    for (const url of blocklist) {
        await sendMessageToBloomFilter(`1 ${url.trim()}`);
    };
});
bloomFilterClient.on('error', (err) => {
    console.error('Error connecting to bloom-filter server:', err);
});

const sendMessageToBloomFilter = async (message) => {
    return new Promise((resolve, reject) => {
        console.log(`sending message to filter: [${message}]`);
        bloomFilterClient.write(message);
        bloomFilterClient.once('data', (data) => {
          console.log(`received message from filter: [${data.toString()}]`);
            resolve(data.toString());
        });
        bloomFilterClient.once('error', (err) => {
            console.log(`received error from filter:`, err);
            reject(err);
        });
    });
};

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
// Like Post Endpoint
app.post("/api/posts/:postId/like", verifyToken, async (req, res) => {
  try {
    const { postId } = req.params;
    const { likes } = req.body;
    // Find the post by ID and update the likes array to add the user's email
    const updatedPost = await Post.findByIdAndUpdate(postId, { likes: likes });

    res.json({ message: "Post liked successfully", post: updatedPost });
  } catch (error) {
    console.error("Error liking post:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Unlike Post Endpoint
app.post("/api/posts/:postId/unlike", verifyToken, async (req, res) => {
  try {
    const { postId } = req.params;
    const { email } = req.body;

    // Find the post by ID and update the likes array to remove the user's email
    const updatedPost = await Post.findByIdAndUpdate(
      postId,
      { $pull: { likes: email } },
      { new: true }
    );

    res.json({ message: "Post unliked successfully", post: updatedPost });
  } catch (error) {
    console.error("Error unliking post:", error);
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
    // Extract post data from the request body
    const { message } = req.body;
    const { image } = req.body;

    const urls = message.match(/\bhttps?:\/\/\S+/gi);
    if (urls) {
        for (const url of urls) {
            const parsedUrl = new URL(url);
            const hostnameWithoutScheme = parsedUrl.hostname;
            const result = await sendMessageToBloomFilter(`2 ${hostnameWithoutScheme}`);
            if (result === 'true true') {
              res.status(400).json({ error: "Message contains malicious URL" });
              return;
            }
        };
    }

    // Create a new post
    const newPost = new Post({
      user: req.params.id,
      message,
      image,
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
}); // Update Post Endpoint
app.put("/api/users/:id/posts/:pid", verifyToken, async (req, res) => {
  try {
    // Access user information from req.user
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
app.delete("/api/users/:id/posts/:postId", verifyToken, async (req, res) => {
  try {
    // Find the post by ID and delete it
    const deletedPost = await Post.findByIdAndDelete(req.params.postId);

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
// POST /api/users/:id/friends
app.post("/api/users/:id/friends", verifyToken, async (req, res) => {
  try {
    const userId = req.user.id; // Use authenticated user's ID
    const friendId = req.params.id; // Extract friend's ID from request params

    if (!friendId) {
      return res.status(400).json({ error: "Friend ID is required" });
    }

    const friend = await User.findById(friendId);
    if (!friend) {
      return res.status(404).json({ error: "Friend not found" });
    }

    const user = await User.findByIdAndUpdate(
      userId,
      { $addToSet: { friendRequestsSent: friendId } }, // Update friendRequestsSent array
      { new: true }
    );

    res.json({ message: "Friend request sent successfully", user });
  } catch (error) {
    console.error("Error sending friend request:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/users/:id/friends/:fid
app.patch("/api/users/:id/friends/:fid", verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const friendId = req.params.fid;

    const user = await User.findById(userId);
    const friend = await User.findById(friendId);

    if (!friend) {
      return res.status(404).json({ error: "Friend not found" });
    }

    if (!user.friendRequestsReceived.includes(friendId)) {
      return res.status(404).json({ error: "Friend request not found" });
    }

    await User.findByIdAndUpdate(
      friendId,
      { $addToSet: { friends: userId }, $pull: { friendRequestsSent: userId } }, // Add to friends, remove from friendRequestsSent
      { new: true }
    );

    user.friends.push(friendId); // Add friend to user's friends list
    user.friendRequestsReceived.pull(friendId); // Remove friend request from user's received list
    await user.save();

    res.json({ message: "Friend request confirmed successfully" });
  } catch (error) {
    console.error("Error confirming friend request:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/users/:id/friends/:fid
app.delete("/api/users/:id/friends/:fid", verifyToken, async (req, res) => {
  try {
    const userId = req.params.id;
    const friendId = req.params.fid;

    const user = await User.findById(userId);

    if (!user.friends.includes(friendId)) {
      return res.status(404).json({ error: "Friend not found" });
    }

    const friend = await User.findById(friendId);

    if (!friend.friends.includes(userId)) {
      return res.status(404).json({ error: "Friend not found" });
    }

    user.friends.pull(friendId);
    await user.save();
    friend.friends.pull(userId);
    await friend.save();

    res.json({ message: "Friend deleted successfully" });
  } catch (error) {
    console.error("Error deleting friend:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/posts/:id", verifyToken, async (req, res) => {
  try {
    // Access user information from req.user
    // Logic to fetch user's feed based on friends
    const userId = req.params.id;

    // Find the current user's friends
    const user = await User.findById(userId);
    const friends = user.friends;

    // Find posts from friends
    const friendPosts = await Post.find({ user: { $in: friends } })
      .sort({ date: -1 })
      .limit(20)
      .populate("user", "name email image");

    // Find posts from users who are not friends
    const nonFriendPosts = await Post.find({ user: { $nin: friends } })
      .sort({ date: -1 })
      .limit(5)
      .populate("user", "name email image");

    // Combine and sort all posts
    const allPosts = friendPosts
      .concat(nonFriendPosts)
      .sort((a, b) => new Date(b.date) - new Date(a.date));

    res.json({ posts: allPosts });
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
    res.json({ token, id: user._id });
  } catch (error) {
    console.error("Error generating token:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});
// Register route
app.post("/api/users/:recipientId/friend-request", async (req, res) => {
  try {
    const { recipientId } = req.params;
    const requestingUserId = req.body.user._id; // Assuming you have middleware to extract user ID from JWT

    // Add recipientId to friendRequestsReceived of recipient user
    await User.findByIdAndUpdate(recipientId, {
      $addToSet: { friendRequestsReceived: requestingUserId },
    });

    // Add requestingUserId to friendRequestsSent of requesting user
    await User.findByIdAndUpdate(requestingUserId, {
      $addToSet: { friendRequestsSent: recipientId },
    });

    res.status(204).end();
  } catch (error) {
    console.error("Error sending friend request:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Approve Friend Request Endpoint
app.patch(
  "/api/users/:requestingUserId/approve-friend-request",
  async (req, res) => {
    try {
      const { requestingUserId } = req.params;
      const approvingUserId = req.body.user._id; // Assuming you have middleware to extract user ID from JWT

      // Remove requestingUserId from friendRequestsReceived of approving user
      await User.findByIdAndUpdate(approvingUserId, {
        $pull: { friendRequestsReceived: requestingUserId },
      });
      // new - Remove approvingUserId from friendRequestsSent of requesting user
      await User.findByIdAndUpdate(requestingUserId, {
        $pull: { friendRequestsSent: approvingUserId },
      });

      // Add approvingUserId to friends of requesting user
      await User.findByIdAndUpdate(requestingUserId, {
        $addToSet: { friends: approvingUserId },
      });
      await User.findByIdAndUpdate(approvingUserId, {
        $addToSet: { friends: requestingUserId },
      });

      res.status(204).end();
    } catch (error) {
      console.error("Error approving friend request:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  }
); // Decline Friend Request Endpoint
app.patch(
  "/api/users/:requestingUserId/decline-friend-request",
  async (req, res) => {
    try {
      const { requestingUserId } = req.params;
      const decliningUserId = req.body.user._id; // Assuming you have middleware to extract user ID from JWT

      // Remove requestingUserId from friendRequestsReceived of declining user
      await User.findByIdAndUpdate(decliningUserId, {
        $pull: { friendRequestsReceived: requestingUserId },
      });
      await User.findByIdAndUpdate(requestingUserId, {
        $pull: { friendRequestsSent: decliningUserId },
      });

      res.status(204).end();
    } catch (error) {
      console.error("Error declining friend request:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  }
);

app.post("/api/register", async (req, res) => {
  try {
    const { name, email, password, image } = req.body;
    // Check if the email already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: "Email already exists" });
    }
    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);
    // Create a new user with an empty friends array
    const newUser = {
      name,
      email,
      password: hashedPassword,
      image,
    };

    // Save the user to the database
    const user = await User.create(newUser);

    res.status(201).json({ message: "User created successfully", user: user });
  } catch (error) {
    console.error("Error registering user:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});
// Modify the backend route to handle GET requests with URL parameters
app.get("/api/search", async (req, res) => {
  try {
    const query = req.query.name; // Extract the value of the "name" parameter from the query string

    // Use the extracted query parameter to search for users by name
    const users = await User.find({ name: { $regex: query, $options: "i" } });

    // Send back the search results as JSON
    res.json({ users });
  } catch (error) {
    // Handle any errors that occur during the search process
    console.error("Error searching users:", error);
    res.status(500).json({ error: "Internal Server Error" });
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
    res.json({ token: token, id: user._id });
  } catch (error) {
    console.error("Error generating token:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
