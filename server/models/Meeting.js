
const mongoose = require("mongoose");

const meetingSchema = new mongoose.Schema(
  {
    // Meeting title
    title: {
      type: String,
      required: [true, "Meeting title is required."],
      trim: true,
      minlength: [3, "Meeting title must be at least 3 characters."],
      maxlength: [120, "Meeting title cannot exceed 120 characters."],
    },

    // Optional meeting description
    description: {
      type: String,
      trim: true,
      maxlength: [500, "Description cannot exceed 500 characters."],
      default: "",
    },

    // Unique code used to join a meeting
    meetingCode: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      index: true,
    },

    // User who created and hosts the meeting
    host: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // Users participating in the meeting
    participants: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],

    // Current meeting status
    status: {
      type: String,
      enum: ["scheduled", "live", "ended"],
      default: "scheduled",
    },

    // Optional scheduled meeting date and time
    scheduledAt: {
      type: Date,
      default: null,
    },

    // Actual meeting start time
    startedAt: {
      type: Date,
      default: null,
    },

    // Actual meeting end time
    endedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Create the Meeting model
const Meeting = mongoose.model("Meeting", meetingSchema);

module.exports = Meeting;
