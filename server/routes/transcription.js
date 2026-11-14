const express = require("express");
const multer = require("multer");
const Groq = require("groq-sdk");
const { toFile } = require("groq-sdk/uploads");
const { protect } = require("../middleware/authMiddleware");

const router = express.Router();

// Accept audio files in memory, with a 25 MB upload limit.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024,
  },
  fileFilter: (req, file, callback) => {
    const allowedTypes = [
  "audio/flac",
  "audio/m4a",
  "audio/mp3",
  "audio/mpeg",
  "audio/mp4",
  "audio/mpga",
  "audio/ogg",
  "audio/wav",
  "audio/x-wav",
  "audio/webm",
  "audio/x-m4a",
  "audio/aac",
  "application/octet-stream",
];

    if (!allowedTypes.includes(file.mimetype)) {
      return callback(
        new Error("Unsupported audio format. Please upload a supported audio file.")
      );
    }

    callback(null, true);
  },
});

// All transcription requests require authentication.
router.use(protect);

// POST /api/transcription
// Upload an audio file and receive its AI-generated transcript.
router.post(
  "/",
  (req, res, next) => {
    upload.single("audio")(req, res, (error) => {
      if (error) {
        if (error instanceof multer.MulterError) {
          const statusCode =
            error.code === "LIMIT_FILE_SIZE" ? 413 : 400;

          return res.status(statusCode).json({
            success: false,
            message:
              error.code === "LIMIT_FILE_SIZE"
                ? "Audio file cannot exceed 25 MB."
                : error.message,
          });
        }

        return res.status(400).json({
          success: false,
          message: error.message || "Unable to upload audio file.",
        });
      }

      next();
    });
  },
  async (req, res) => {
    try {
      if (!process.env.GROQ_API_KEY) {
        return res.status(503).json({
          success: false,
          message: "AI transcription service is not configured.",
        });
      }

      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: "Please upload an audio file using the audio field.",
        });
      }

      const groq = new Groq({
        apiKey: process.env.GROQ_API_KEY,
      });

      const audioFile = await toFile(
        req.file.buffer,
        req.file.originalname || "meeting-audio.webm",
        {
          type: req.file.mimetype,
        }
      );

      const transcription = await groq.audio.transcriptions.create({
        file: audioFile,
        model: "whisper-large-v3-turbo",
        response_format: "json",
      });

      return res.status(200).json({
        success: true,
        message: "Audio transcribed successfully.",
        transcript: transcription.text,
      });
    } catch (error) {
      console.error(
        "Transcription error:",
        error.status || "",
        error.message
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to transcribe audio. Please try again with a supported audio file.",
      });
    }
  }
);

module.exports = router;