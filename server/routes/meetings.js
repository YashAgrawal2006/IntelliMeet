
const express = require("express");
const crypto = require("node:crypto");

const Meeting = require("../models/Meeting");
const { protect } = require("../middleware/authMiddleware");

const router = express.Router();

// All meeting routes require authentication.
router.use(protect);

// Generate a unique meeting code.
async function generateMeetingCode() {
  let meetingCode;

  do {
    meetingCode = crypto.randomBytes(4).toString("hex").toUpperCase();
  } while (await Meeting.exists({ meetingCode }));

  return meetingCode;
}

// POST /api/meetings
// Create a new meeting.
router.post("/", async (req, res) => {
  try {
    const { title, description, scheduledAt } = req.body;

    if (typeof title !== "string" || !title.trim()) {
      return res.status(400).json({
        success: false,
        message: "Meeting title is required.",
      });
    }

    if (title.trim().length > 120) {
      return res.status(400).json({
        success: false,
        message: "Meeting title cannot exceed 120 characters.",
      });
    }

    if (
      description !== undefined &&
      (typeof description !== "string" || description.length > 500)
    ) {
      return res.status(400).json({
        success: false,
        message: "Description must be a string of 500 characters or fewer.",
      });
    }

    let meetingDate = null;

    if (scheduledAt !== undefined && scheduledAt !== null) {
      meetingDate = new Date(scheduledAt);

      if (Number.isNaN(meetingDate.getTime())) {
        return res.status(400).json({
          success: false,
          message: "Please provide a valid meeting date.",
        });
      }

      if (meetingDate <= new Date()) {
        return res.status(400).json({
          success: false,
          message: "Scheduled meeting time must be in the future.",
        });
      }
    }

    const meetingCode = await generateMeetingCode();

    const meeting = await Meeting.create({
      title: title.trim(),
      description: description?.trim() || "",
      meetingCode,
      host: req.user._id,
      participants: [req.user._id],
      status: "scheduled",
      scheduledAt: meetingDate,
    });

    return res.status(201).json({
      success: true,
      message: "Meeting created successfully.",
      meeting,
    });
  } catch (error) {
    console.error("Create meeting error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to create meeting.",
    });
  }
});

// GET /api/meetings
// Get meetings created or joined by the logged-in user.
router.get("/", async (req, res) => {
  try {
    const meetings = await Meeting.find({
      $or: [
        { host: req.user._id },
        { participants: req.user._id },
      ],
    })
      .populate("host", "name email")
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: meetings.length,
      meetings,
    });
  } catch (error) {
    console.error("Fetch meetings error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to fetch meetings.",
    });
  }
});

// GET /api/meetings/:meetingCode
// Get meeting details.
router.get("/:meetingCode", async (req, res) => {
  try {
    const meeting = await Meeting.findOne({
      meetingCode: req.params.meetingCode.toUpperCase(),
    })
      .populate("host", "name email")
      .populate("participants", "name email");

    if (!meeting) {
      return res.status(404).json({
        success: false,
        message: "Meeting not found.",
      });
    }

    const isParticipant = meeting.participants.some(
      (participant) => participant._id.equals(req.user._id)
    );

    if (!isParticipant) {
      return res.status(403).json({
        success: false,
        message: "You are not a participant of this meeting.",
      });
    }

    return res.status(200).json({
      success: true,
      meeting,
    });
  } catch (error) {
    console.error("Fetch meeting details error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to fetch meeting details.",
    });
  }
});

// POST /api/meetings/:meetingCode/join
// Join a meeting using its unique code.

// POST /api/meetings/:meetingCode/start
// Only the host can start a meeting.
router.post("/:meetingCode/start", async (req, res) => {
  try {
    const meeting = await Meeting.findOne({
      meetingCode: req.params.meetingCode.toUpperCase(),
    });

    if (!meeting) {
      return res.status(404).json({
        success: false,
        message: "Meeting not found.",
      });
    }

    if (!meeting.host.equals(req.user._id)) {
      return res.status(403).json({
        success: false,
        message: "Only the host can start this meeting.",
      });
    }

    if (meeting.status !== "scheduled") {
      return res.status(400).json({
        success: false,
        message: "Only scheduled meetings can be started.",
      });
    }

    meeting.status = "live";
    meeting.startedAt = new Date();

    await meeting.save();

    return res.status(200).json({
      success: true,
      message: "Meeting started successfully.",
      meeting,
    });
  } catch (error) {
    console.error("Start meeting error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to start meeting.",
    });
  }
});

// POST /api/meetings/:meetingCode/end
// Only the host can end a meeting.
router.post("/:meetingCode/end", async (req, res) => {
  try {
    const meeting = await Meeting.findOne({
      meetingCode: req.params.meetingCode.toUpperCase(),
    });

    if (!meeting) {
      return res.status(404).json({
        success: false,
        message: "Meeting not found.",
      });
    }

    if (!meeting.host.equals(req.user._id)) {
      return res.status(403).json({
        success: false,
        message: "Only the host can end this meeting.",
      });
    }

    if (meeting.status !== "live") {
      return res.status(400).json({
        success: false,
        message: "Only live meetings can be ended.",
      });
    }

    meeting.status = "ended";
    meeting.endedAt = new Date();

    await meeting.save();

    return res.status(200).json({
      success: true,
      message: "Meeting ended successfully.",
      meeting,
    });
  } catch (error) {
    console.error("End meeting error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to end meeting.",
    });
  }
});

router.post("/:meetingCode/join", async (req, res) => {
  try {
    const meeting = await Meeting.findOne({
      meetingCode: req.params.meetingCode.toUpperCase(),
    });

    if (!meeting) {
      return res.status(404).json({
        success: false,
        message: "Invalid meeting code. Meeting not found.",
      });
    }

    if (meeting.status === "ended") {
      return res.status(400).json({
        success: false,
        message: "This meeting has already ended.",
      });
    }

    const alreadyJoined = meeting.participants.some(
      (participantId) => participantId.equals(req.user._id)
    );

    if (alreadyJoined) {
      return res.status(200).json({
        success: true,
        message: "You are already a participant.",
        meeting,
      });
    }

    meeting.participants.push(req.user._id);
    await meeting.save();

    return res.status(200).json({
      success: true,
      message: "You joined the meeting successfully.",
      meeting,
    });
  } catch (error) {
    console.error("Join meeting error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to join meeting.",
    });
  }
});

module.exports = router;
