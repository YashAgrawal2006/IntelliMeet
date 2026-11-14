
const dns = require("node:dns");
dns.setServers(["8.8.8.8", "1.1.1.1"]);

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const mongoose = require("mongoose");
const http = require("node:http");
const jwt = require("jsonwebtoken");
const { Server } = require("socket.io");

const authRoutes = require("./routes/auth");
const meetingRoutes = require("./routes/meetings");
const Meeting = require("./models/Meeting");
const transcriptionRoutes = require("./routes/transcription");
const aiRoutes = require("./routes/ai");

const app = express();
const PORT = process.env.PORT || 5000;

// ==========================================
// FRONTEND CORS CONFIGURATION
// ==========================================

const allowedOrigins = (
  process.env.CLIENT_URLS ||
  "http://localhost:5173,http://localhost:4173"
)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    console.warn(`CORS blocked origin: ${origin}`);

    return callback(new Error("Origin not allowed by CORS."));
  },
  methods: ["GET", "POST"],
};

// ==========================================
// HTTP SERVER AND SOCKET.IO
// ==========================================

const httpServer = http.createServer(app);

const io = new Server(httpServer, {
  cors: corsOptions,
});

// ==========================================
// EXPRESS MIDDLEWARE
// ==========================================

app.use(helmet());
app.use(cors(corsOptions));
app.use(express.json({ limit: "10kb" }));

// ==========================================
// API HEALTH CHECK
// ==========================================

app.get("/api/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "IntelliMeet API is running!",
    timestamp: new Date().toISOString(),
  });
});

// ==========================================
// MONGODB HEALTH CHECK
// ==========================================

app.get("/api/db-health", (req, res) => {
  const isConnected = mongoose.connection.readyState === 1;

  res.status(isConnected ? 200 : 503).json({
    success: isConnected,
    message: isConnected
      ? "MongoDB is connected!"
      : "MongoDB is not connected.",
  });
});

// ==========================================
// APPLICATION ROUTES
// ==========================================

app.use("/api/auth", authRoutes);
app.use("/api/meetings", meetingRoutes);
app.use("/api/transcription", transcriptionRoutes);
app.use("/api/ai", aiRoutes);

// Handle unknown routes
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
  });
});

// ==========================================
// SOCKET.IO JWT AUTHENTICATION
// ==========================================

io.use((socket, next) => {
  try {
    const token = socket.handshake.auth?.token;

    if (!token) {
      return next(
        new Error("Authentication token is required.")
      );
    }

    if (!process.env.JWT_SECRET) {
      return next(
        new Error("Server authentication is not configured.")
      );
    }

    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET,
      {
        algorithms: ["HS256"],
      }
    );

    if (
      typeof decoded === "string" ||
      !decoded.userId
    ) {
      return next(
        new Error("Invalid authentication token.")
      );
    }

    socket.data.userId = String(decoded.userId);

    next();
  } catch (error) {
    next(
      new Error("Authentication failed. Please log in again.")
    );
  }
});

// ==========================================
// REAL-TIME MEETING CONNECTIONS
// ==========================================

io.on("connection", (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  // ==========================================
  // JOIN AN AUTHORIZED MEETING ROOM
  // ==========================================

  socket.on("meeting:join", async (payload, acknowledge) => {
    const reply =
      typeof acknowledge === "function"
        ? acknowledge
        : () => {};

    try {
      const meetingCode = String(payload?.meetingCode || "")
        .trim()
        .toUpperCase();

      if (!meetingCode) {
        return reply({
          success: false,
          message: "Meeting code is required.",
        });
      }

      const meeting = await Meeting.findOne({
        meetingCode,
        $or: [
          { host: socket.data.userId },
          { participants: socket.data.userId },
        ],
      }).select("meetingCode status");

      if (!meeting) {
        return reply({
          success: false,
          message: "Meeting not found or access denied.",
        });
      }

      if (meeting.status === "ended") {
        return reply({
          success: false,
          message: "This meeting has already ended.",
        });
      }

      // Leave the previous meeting room if necessary
      const previousCode = socket.data.meetingCode;

      if (previousCode && previousCode !== meetingCode) {
        const previousRoom = `meeting:${previousCode}`;

        socket.to(previousRoom).emit("participant:left", {
          userId: socket.data.userId,
          socketId: socket.id,
        });

        await socket.leave(previousRoom);
      }

      const roomName = `meeting:${meetingCode}`;
      const alreadyJoined = socket.rooms.has(roomName);

      await socket.join(roomName);

      socket.data.meetingCode = meetingCode;

      // Notify existing participants that someone joined
      if (!alreadyJoined) {
        socket.to(roomName).emit("participant:joined", {
          userId: socket.data.userId,
          socketId: socket.id,
        });
      }

      // Retrieve currently connected participants
      const connectedSockets = await io
        .in(roomName)
        .fetchSockets();

      // Get unique online user IDs
      const onlineUserIds = [
        ...new Set(
          connectedSockets.map((connectedSocket) =>
            String(connectedSocket.data.userId)
          )
        ),
      ];

      // Get socket IDs for WebRTC connections
      const onlineParticipants = connectedSockets.map(
        (connectedSocket) => ({
          userId: String(connectedSocket.data.userId),
          socketId: connectedSocket.id,
        })
      );

      reply({
        success: true,
        message: "Successfully joined the meeting room.",
        meetingCode,
        onlineUserIds,
        onlineParticipants,
      });
    } catch (error) {
      console.error("Socket meeting join error:", error);

      reply({
        success: false,
        message: "Unable to join the meeting room.",
      });
    }
  });

  // ==========================================
  // REAL-TIME MEETING CHAT
  // ==========================================

  socket.on("chat:send", async (payload, acknowledge) => {
    const reply =
      typeof acknowledge === "function"
        ? acknowledge
        : () => {};

    try {
      const meetingCode = socket.data.meetingCode;
      const roomName = meetingCode
        ? `meeting:${meetingCode}`
        : "";

      const message = String(payload?.message || "").trim();

      if (!meetingCode || !socket.rooms.has(roomName)) {
        return reply({
          success: false,
          message: "Join a meeting before sending messages.",
        });
      }

      if (!message) {
        return reply({
          success: false,
          message: "Message cannot be empty.",
        });
      }

      if (message.length > 1000) {
        return reply({
          success: false,
          message: "Messages cannot exceed 1000 characters.",
        });
      }

      const meeting = await Meeting.findOne({
        meetingCode,
        $or: [
          { host: socket.data.userId },
          { participants: socket.data.userId },
        ],
      }).populate("host participants", "name");

      if (!meeting || meeting.status === "ended") {
        return reply({
          success: false,
          message: "This meeting is no longer available.",
        });
      }

      const sender = [meeting.host, ...(meeting.participants || [])]
        .find(
          (person) =>
            person &&
            String(person._id) === String(socket.data.userId)
        );

      if (!sender) {
        return reply({
          success: false,
          message: "You are not authorized to send messages here.",
        });
      }

      const chatMessage = {
        id: `${socket.id}-${Date.now()}`,
        senderId: String(socket.data.userId),
        senderName: sender.name || "Participant",
        message,
        timestamp: new Date().toISOString(),
      };

      // Broadcast message to everyone in this meeting
      io.to(roomName).emit("chat:message", chatMessage);

      reply({
        success: true,
        message: "Message sent.",
      });
    } catch (error) {
      console.error("Meeting chat error:", error);

      reply({
        success: false,
        message: "Unable to send your message.",
      });
    }
  });

  // ==========================================
  // WEBRTC SIGNALING
  // ==========================================

  const forwardWebRTCSignal = (
    eventName,
    payload,
    dataKey
  ) => {
    try {
      const targetSocketId = String(
        payload?.targetSocketId || ""
      ).trim();

      const signalData = payload?.[dataKey];
      const meetingCode = socket.data.meetingCode;

      if (
        !meetingCode ||
        !targetSocketId ||
        targetSocketId === socket.id ||
        !signalData ||
        typeof signalData !== "object"
      ) {
        return;
      }

      const roomName = `meeting:${meetingCode}`;

      if (!socket.rooms.has(roomName)) {
        return;
      }

      const targetSocket =
        io.sockets.sockets.get(targetSocketId);

      if (
        !targetSocket ||
        targetSocket.data.meetingCode !== meetingCode ||
        !targetSocket.rooms.has(roomName)
      ) {
        return;
      }

      io.to(targetSocketId).emit(eventName, {
        fromSocketId: socket.id,
        fromUserId: socket.data.userId,
        [dataKey]: signalData,
      });
    } catch (error) {
      console.error("WebRTC signaling error:", error);
    }
  };

  // Forward WebRTC offers
  socket.on("webrtc:offer", (payload) => {
    forwardWebRTCSignal(
      "webrtc:offer",
      payload,
      "description"
    );
  });

  // Forward WebRTC answers
  socket.on("webrtc:answer", (payload) => {
    forwardWebRTCSignal(
      "webrtc:answer",
      payload,
      "description"
    );
  });

  // Forward ICE candidates
  socket.on("webrtc:ice-candidate", (payload) => {
    forwardWebRTCSignal(
      "webrtc:ice-candidate",
      payload,
      "candidate"
    );
  });

  // ==========================================
  // LEAVE MEETING ROOM
  // ==========================================

  socket.on("meeting:leave", async (acknowledge) => {
    const reply =
      typeof acknowledge === "function"
        ? acknowledge
        : () => {};

    const meetingCode = socket.data.meetingCode;

    if (!meetingCode) {
      return reply({
        success: true,
        message: "You are not currently in a meeting room.",
      });
    }

    const roomName = `meeting:${meetingCode}`;

    socket.to(roomName).emit("participant:left", {
      userId: socket.data.userId,
      socketId: socket.id,
    });

    await socket.leave(roomName);

    delete socket.data.meetingCode;

    reply({
      success: true,
      message: "You left the meeting room.",
    });
  });

  // ==========================================
  // HANDLE DISCONNECTION
  // ==========================================

  socket.on("disconnect", (reason) => {
    const meetingCode = socket.data.meetingCode;

    if (meetingCode) {
      const roomName = `meeting:${meetingCode}`;

      socket.to(roomName).emit("participant:left", {
        userId: socket.data.userId,
        socketId: socket.id,
      });
    }

    console.log(
      `Socket disconnected: ${socket.id}. Reason: ${reason}`
    );
  });
});

// ==========================================
// START SERVER AFTER MONGODB CONNECTS
// ==========================================

async function startServer() {
  try {
    if (!process.env.MONGODB_URI) {
      throw new Error(
        "MONGODB_URI is missing from the server .env file."
      );
    }

    if (!process.env.JWT_SECRET) {
      throw new Error(
        "JWT_SECRET is missing from the server .env file."
      );
    }

    await mongoose.connect(process.env.MONGODB_URI);

    console.log("MongoDB connected successfully!");

    console.log("Allowed frontend origins:", allowedOrigins);

    httpServer.listen(PORT, () => {
      console.log(
        `IntelliMeet API running at http://localhost:${PORT}`
      );

      console.log("Socket.IO server is ready!");
    });
  } catch (error) {
    console.error(
      "Server startup failed:",
      error.message
    );

    process.exit(1);
  }
}

startServer();
