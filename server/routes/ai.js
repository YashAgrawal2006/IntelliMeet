
const express = require("express");
const Groq = require("groq-sdk");
const { protect } = require("../middleware/authMiddleware");

const router = express.Router();

router.use(protect);

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

const AI_MODEL ="openai/gpt-oss-120b";

// Validate transcript input.
function validateTranscript(transcript) {
  return (
    typeof transcript === "string" &&
    transcript.trim().length >= 20 &&
    transcript.length <= 50000
  );
}

// POST /api/ai/summary
// Generate an AI-powered meeting summary.
router.post("/summary", async (req, res) => {
  try {
    const { transcript } = req.body;

    if (!validateTranscript(transcript)) {
      return res.status(400).json({
        success: false,
        message:
          "Please provide a transcript between 20 and 50000 characters.",
      });
    }

    if (!process.env.GROQ_API_KEY) {
      return res.status(503).json({
        success: false,
        message: "AI service is not configured.",
      });
    }

    const completion = await groq.chat.completions.create({
      model: AI_MODEL,
      messages: [
        {
          role: "system",
          content: `
You are an enterprise meeting assistant.
Analyze the meeting transcript and produce a clear,
professional summary.

Return valid JSON with these fields:
{
  "title": "Short meeting title",
  "overview": "Brief meeting overview",
  "keyPoints": ["Important discussion points"],
  "decisions": ["Decisions made"],
  "conclusion": "Meeting conclusion"
}

Do not invent information that is not in the transcript.
If a section has no information, return an empty string or array.
`,
        },
        {
          role: "user",
          content: transcript.trim(),
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
    });

    const summary = JSON.parse(
      completion.choices[0].message.content
    );

    return res.status(200).json({
      success: true,
      message: "Meeting summary generated successfully.",
      summary,
    });
  } catch (error) {
    console.error("AI summary error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to generate meeting summary.",
    });
  }
});

// POST /api/ai/action-items
// Extract tasks and responsibilities from a transcript.
router.post("/action-items", async (req, res) => {
  try {
    const { transcript } = req.body;

    if (!validateTranscript(transcript)) {
      return res.status(400).json({
        success: false,
        message:
          "Please provide a transcript between 20 and 50000 characters.",
      });
    }

    if (!process.env.GROQ_API_KEY) {
      return res.status(503).json({
        success: false,
        message: "AI service is not configured.",
      });
    }

    const completion = await groq.chat.completions.create({
      model: AI_MODEL,
      messages: [
        {
          role: "system",
          content: `
You are an enterprise meeting task assistant.
Extract actionable tasks from the meeting transcript.

Return valid JSON in this structure:
{
  "actionItems": [
    {
      "task": "Description of the task",
      "assignee": "Person's name or Unassigned",
      "deadline": "Deadline mentioned or Not specified",
      "priority": "High, Medium, or Low"
    }
  ]
}

Do not invent assignees or deadlines.
Only extract tasks explicitly discussed.
If no actionable tasks exist, return an empty array.
`,
        },
        {
          role: "user",
          content: transcript.trim(),
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
    });

    const result = JSON.parse(
      completion.choices[0].message.content
    );

    return res.status(200).json({
      success: true,
      message: "Action items extracted successfully.",
      ...result,
    });
  } catch (error) {
    console.error("AI action-items error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to extract action items.",
    });
  }
});

module.exports = router;
