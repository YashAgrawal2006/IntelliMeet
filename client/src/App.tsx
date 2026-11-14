
import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
} from "react";

import "./App.css";
import MeetingRoom from "./MeetingRoom";

const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5000/api"
).replace(/\/$/, "");

type User = {
  id: string;
  name: string;
  email: string;
  role: string;
};

type Meeting = {
  _id: string;
  title: string;
  description: string;
  meetingCode: string;
  status: "scheduled" | "live" | "ended";
  scheduledAt: string | null;
  createdAt: string;
  host:
    | {
        _id: string;
        name: string;
        email: string;
      }
    | string;
};

type AuthMode = "login" | "register";

type MeetingSummary = {
  title: string;
  overview: string;
  keyPoints: string[];
  decisions: string[];
  conclusion: string;
};

type ActionItem = {
  task: string;
  assignee: string;
  deadline: string;
  priority: "High" | "Medium" | "Low" | string;
};

function App() {
  // Authentication states
  const [mode, setMode] = useState<AuthMode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [user, setUser] = useState<User | null>(() => {
    try {
      const savedUser = sessionStorage.getItem("intellimeet_user");
      return savedUser ? JSON.parse(savedUser) : null;
    } catch {
      return null;
    }
  });

  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  // Meeting states
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [meetingTitle, setMeetingTitle] = useState("");
  const [meetingDescription, setMeetingDescription] = useState("");
  const [joinCode, setJoinCode] = useState("");

  const [meetingLoading, setMeetingLoading] = useState(false);
  const [dashboardMessage, setDashboardMessage] = useState("");
  const [dashboardError, setDashboardError] = useState(false);
  const [activeMeeting, setActiveMeeting] = useState<string | null>(null);

  const [selectedMeetingCode, setSelectedMeetingCode] =
    useState<string | null>(null);

  // AI Assistant states
  const [transcript, setTranscript] = useState("");
  const [aiLoading, setAiLoading] = useState<
    "summary" | "actions" | null
  >(null);
  const [aiError, setAiError] = useState("");
  const [aiSummary, setAiSummary] = useState<MeetingSummary | null>(null);
  const [actionItems, setActionItems] = useState<ActionItem[] | null>(null);
  const [aiMessage, setAiMessage] = useState("");

  // Common authenticated API request
  const authenticatedRequest = useCallback(
    async (endpoint: string, options: RequestInit = {}) => {
      const token = sessionStorage.getItem("intellimeet_token");

      if (!token) {
        throw new Error(
          "Authentication token not found. Please log in again."
        );
      }

      const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...options.headers,
          Authorization: `Bearer ${token}`,
        },
      });

      let data: any = {};

      try {
        data = await response.json();
      } catch {
        // Keep an empty response object if the server returns no JSON.
      }

      if (!response.ok) {
        throw new Error(
          data.message || `Request failed (${response.status}).`
        );
      }

      return data;
    },
    []
  );

  // Fetch meetings
  const fetchMeetings = useCallback(async () => {
    setMeetingLoading(true);
    setDashboardError(false);

    try {
      const data = await authenticatedRequest("/meetings");

      setMeetings(Array.isArray(data.meetings) ? data.meetings : []);
      setDashboardMessage("");
    } catch (error) {
      setDashboardError(true);
      setDashboardMessage(
        error instanceof Error
          ? error.message
          : "Unable to fetch meetings."
      );
    } finally {
      setMeetingLoading(false);
    }
  }, [authenticatedRequest]);

  // Load meetings after login
  useEffect(() => {
    if (user) {
      fetchMeetings();
    }
  }, [user, fetchMeetings]);

  // Register or log in
  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage("");
    setLoading(true);

    const endpoint =
      mode === "register" ? "/auth/register" : "/auth/login";

    const requestBody =
      mode === "register"
        ? { name, email, password }
        : { email, password };

    try {
      const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Something went wrong.");
      }

      if (mode === "register") {
        setMessage("Account created successfully! Please log in.");
        setMode("login");
        setName("");
        setPassword("");
      } else {
        sessionStorage.setItem("intellimeet_token", data.token);
        sessionStorage.setItem(
          "intellimeet_user",
          JSON.stringify(data.user)
        );

        setUser(data.user);
        setPassword("");
        setMessage("");
      }
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to connect to the server."
      );
    } finally {
      setLoading(false);
    }
  };

  // Create a meeting
  const handleCreateMeeting = async (
    event: FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();

    setDashboardMessage("");
    setDashboardError(false);
    setMeetingLoading(true);

    try {
      const data = await authenticatedRequest("/meetings", {
        method: "POST",
        body: JSON.stringify({
          title: meetingTitle,
          description: meetingDescription,
        }),
      });

      const newMeetingCode = data.meeting?.meetingCode;

      if (!newMeetingCode) {
        throw new Error(
          "Meeting was created, but no meeting code was returned."
        );
      }

      setMeetingTitle("");
      setMeetingDescription("");

      await fetchMeetings();
      setSelectedMeetingCode(newMeetingCode);
    } catch (error) {
      setDashboardError(true);
      setDashboardMessage(
        error instanceof Error
          ? error.message
          : "Unable to create meeting."
      );
    } finally {
      setMeetingLoading(false);
    }
  };

  // Join a meeting
  const handleJoinMeeting = async (
    event: FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();

    const code = joinCode.trim().toUpperCase();

    if (!code) {
      setDashboardError(true);
      setDashboardMessage("Please enter a meeting code.");
      return;
    }

    setDashboardMessage("");
    setDashboardError(false);
    setMeetingLoading(true);

    try {
      await authenticatedRequest(
        `/meetings/${encodeURIComponent(code)}/join`,
        { method: "POST" }
      );

      setJoinCode("");
      await fetchMeetings();
      setSelectedMeetingCode(code);
    } catch (error) {
      setDashboardError(true);
      setDashboardMessage(
        error instanceof Error
          ? error.message
          : "Unable to join meeting."
      );
    } finally {
      setMeetingLoading(false);
    }
  };

  // Start or end a meeting
  const handleMeetingAction = async (
    meetingCode: string,
    action: "start" | "end"
  ) => {
    setActiveMeeting(meetingCode);
    setDashboardMessage("");
    setDashboardError(false);

    try {
      const data = await authenticatedRequest(
        `/meetings/${encodeURIComponent(meetingCode)}/${action}`,
        { method: "POST" }
      );

      setDashboardMessage(
        data.message || `Meeting ${action}ed successfully.`
      );

      await fetchMeetings();
    } catch (error) {
      setDashboardError(true);
      setDashboardMessage(
        error instanceof Error
          ? error.message
          : `Unable to ${action} meeting.`
      );
    } finally {
      setActiveMeeting(null);
    }
  };

  // AI: Generate meeting summary
  const handleGenerateSummary = async () => {
    if (transcript.trim().length < 20) {
      setAiError("Please enter a transcript containing at least 20 characters.");
      return;
    }

    setAiLoading("summary");
    setAiError("");
    setAiMessage("");
    setAiSummary(null);

    try {
      const data = await authenticatedRequest("/ai/summary", {
        method: "POST",
        body: JSON.stringify({
          transcript: transcript.trim(),
        }),
      });

      if (!data.summary) {
        throw new Error("The AI service returned an empty summary.");
      }

      setAiSummary(data.summary);
      setAiMessage("Meeting summary generated successfully.");
    } catch (error) {
      setAiError(
        error instanceof Error
          ? error.message
          : "Unable to generate the meeting summary."
      );
    } finally {
      setAiLoading(null);
    }
  };

  // AI: Extract action items
  const handleExtractActionItems = async () => {
    if (transcript.trim().length < 20) {
      setAiError("Please enter a transcript containing at least 20 characters.");
      return;
    }

    setAiLoading("actions");
    setAiError("");
    setAiMessage("");
    setActionItems(null);

    try {
      const data = await authenticatedRequest("/ai/action-items", {
        method: "POST",
        body: JSON.stringify({
          transcript: transcript.trim(),
        }),
      });

      setActionItems(
        Array.isArray(data.actionItems) ? data.actionItems : []
      );

      setAiMessage("Action items extracted successfully.");
    } catch (error) {
      setAiError(
        error instanceof Error
          ? error.message
          : "Unable to extract action items."
      );
    } finally {
      setAiLoading(null);
    }
  };

  // Copy AI output
  const handleCopyAIResult = async (content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setAiMessage("Copied to clipboard!");
    } catch {
      setAiError("Unable to copy. Please select and copy the text manually.");
    }
  };

  // Reset AI results
  const handleClearAI = () => {
    setTranscript("");
    setAiSummary(null);
    setActionItems(null);
    setAiError("");
    setAiMessage("");
  };

  // Return from meeting room
  const handleBackToDashboard = async () => {
    setSelectedMeetingCode(null);
    await fetchMeetings();
  };

  // Called after host ends a meeting
  const handleMeetingEnded = async () => {
    setSelectedMeetingCode(null);
    await fetchMeetings();

    setDashboardMessage("Meeting ended successfully.");
    setDashboardError(false);
  };

  // Log out
  const handleLogout = () => {
    sessionStorage.removeItem("intellimeet_token");
    sessionStorage.removeItem("intellimeet_user");

    setUser(null);
    setMeetings([]);
    setSelectedMeetingCode(null);
    setEmail("");
    setPassword("");
    setMessage("You have been logged out.");
    setDashboardMessage("");
    setTranscript("");
    setAiSummary(null);
    setActionItems(null);
    setAiError("");
    setAiMessage("");
    setMode("login");
  };

  // Authentication screen
  if (!user) {
    return (
      <main className="auth-page">
        <section className="auth-intro">
          <div className="brand">
            IntelliMeet<span>.</span>
          </div>

          <div className="intro-content">
            <p className="eyebrow">MEET. COLLABORATE. ACHIEVE.</p>
            <h1>Make every meeting more meaningful.</h1>
            <p>
              Bring your meetings, conversations, and team collaboration
              together in one intelligent workspace.
            </p>
          </div>

          <p className="intro-footer">
            Intelligent collaboration starts here.
          </p>
        </section>

        <section className="auth-panel">
          <div className="auth-form-container">
            <p className="eyebrow">
              {mode === "login" ? "WELCOME BACK" : "GET STARTED"}
            </p>

            <h2>
              {mode === "login"
                ? "Sign in to IntelliMeet"
                : "Create your account"}
            </h2>

            <p className="form-description">
              {mode === "login"
                ? "Enter your credentials to access your workspace."
                : "Join IntelliMeet and start collaborating."}
            </p>

            <form onSubmit={handleSubmit}>
              {mode === "register" && (
                <div className="form-group">
                  <label htmlFor="name">Full name</label>
                  <input
                    id="name"
                    type="text"
                    placeholder="Enter your full name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    maxLength={100}
                    required
                  />
                </div>
              )}

              <div className="form-group">
                <label htmlFor="email">Email address</label>
                <input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="password">Password</label>
                <input
                  id="password"
                  type="password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  minLength={8}
                  maxLength={72}
                  required
                />
              </div>

              {message && (
                <p className="status-message" role="status">
                  {message}
                </p>
              )}

              <button
                className="submit-button"
                type="submit"
                disabled={loading}
              >
                {loading
                  ? "Please wait..."
                  : mode === "login"
                    ? "Sign in"
                    : "Create account"}
              </button>
            </form>

            <p className="switch-mode">
              {mode === "login"
                ? "Don't have an account?"
                : "Already have an account?"}

              <button
                type="button"
                onClick={() => {
                  setMessage("");
                  setMode(mode === "login" ? "register" : "login");
                }}
              >
                {mode === "login" ? "Create account" : "Sign in"}
              </button>
            </p>

            <p className="security-note">
              Your workspace is protected by IntelliMeet authentication.
            </p>
          </div>
        </section>
      </main>
    );
  }

  // Meeting room screen
  if (selectedMeetingCode) {
    return (
      <MeetingRoom
        meetingCode={selectedMeetingCode}
        currentUserId={user.id}
        onBack={handleBackToDashboard}
        onMeetingEnded={handleMeetingEnded}
      />
    );
  }

  // Dashboard statistics
  const liveMeetings = meetings.filter(
    (meeting) => meeting.status === "live"
  ).length;

  const scheduledMeetings = meetings.filter(
    (meeting) => meeting.status === "scheduled"
  ).length;

  return (
    <main className="dashboard-shell">
      <aside className="app-sidebar">
        <a
          className="sidebar-brand"
          href="#overview"
          aria-label="IntelliMeet home"
        >
          <span className="brand-mark">i</span>
          <span>
            IntelliMeet<span className="brand-period">.</span>
          </span>
        </a>

        <p className="sidebar-section-label">WORKSPACE</p>

        <nav
          className="sidebar-navigation"
          aria-label="Workspace navigation"
        >
          <a className="sidebar-nav-link active" href="#overview">
            <span className="nav-icon">⌂</span>
            Overview
          </a>

          <a className="sidebar-nav-link" href="#meetings">
            <span className="nav-icon">▤</span>
            My meetings
          </a>

          <a className="sidebar-nav-link" href="#create-meeting">
            <span className="nav-icon">＋</span>
            Create meeting
          </a>
        </nav>

        <p className="sidebar-section-label tools-label">YOUR TOOLS</p>

        <div className="sidebar-navigation">
          <a className="sidebar-nav-link" href="#ai-assistant">
            <span className="nav-icon">✧</span>
            AI assistant
            <small>AI</small>
          </a>

          <div className="sidebar-nav-link disabled-nav">
            <span className="nav-icon">◈</span>
            Collaboration
            <small>SOON</small>
          </div>
        </div>

        <div className="sidebar-support">
          <span className="support-icon">?</span>
          <div>
            <strong>Need a hand?</strong>
            <span>Your workspace is ready.</span>
          </div>
        </div>
      </aside>

      <div className="dashboard-main">
        <header className="dashboard-topbar">
          <div className="mobile-brand">
            <span className="brand-mark">i</span>
            IntelliMeet<span className="brand-period">.</span>
          </div>

          <div className="breadcrumb">
            Workspace <span>/</span> Overview
          </div>

          <div className="topbar-account">
            <div className="account-avatar">
              {user.name.trim().charAt(0).toUpperCase()}
            </div>

            <div className="account-copy">
              <strong>{user.name}</strong>
              <span>{user.role}</span>
            </div>

            <button
              className="logout-button"
              type="button"
              onClick={handleLogout}
            >
              Log out <span>↗</span>
            </button>
          </div>
        </header>

        <div className="dashboard-content" id="overview">
          <section className="dashboard-welcome">
            <div>
              <p className="eyebrow">YOUR WORKSPACE</p>
              <h1>
                Welcome back, {user.name.split(" ")[0]}{" "}
                <span className="welcome-sparkle">✦</span>
              </h1>
              <p>
                Bring your people together and make every conversation count.
              </p>
            </div>

            <a className="new-meeting-link" href="#create-meeting">
              <span>＋</span> New meeting
            </a>
          </section>

          {dashboardMessage && (
            <p
              className={`status-message dashboard-alert ${
                dashboardError ? "alert-error" : "alert-success"
              }`}
              role="status"
            >
              {dashboardMessage}
            </p>
          )}

          <section className="stats-grid" aria-label="Meeting statistics">
            <article className="stat-card">
              <span className="stat-icon stat-blue">▤</span>
              <div>
                <span className="stat-label">Total meetings</span>
                <strong>{meetings.length}</strong>
                <small>Created or joined by you</small>
              </div>
            </article>

            <article className="stat-card">
              <span className="stat-icon stat-green">
                <i className="live-dot" />
              </span>
              <div>
                <span className="stat-label">Live meetings</span>
                <strong>{liveMeetings}</strong>
                <small>Currently in progress</small>
              </div>
            </article>

            <article className="stat-card">
              <span className="stat-icon stat-purple">◷</span>
              <div>
                <span className="stat-label">Upcoming meetings</span>
                <strong>{scheduledMeetings}</strong>
                <small>Scheduled and ready</small>
              </div>
            </article>
          </section>

          {/* Create and join meeting */}
          <section className="start-section" id="create-meeting">
            <div className="section-heading">
              <div>
                <p className="eyebrow">GET STARTED</p>
                <h2>Start connecting</h2>
                <p>
                  Create a room or join your team with a meeting code.
                </p>
              </div>
            </div>

            <div className="meeting-actions-grid">
              <section className="meeting-action-card create-meeting-card">
                <div className="action-card-heading">
                  <span className="action-icon">＋</span>
                  <span className="action-kicker">HOST A MEETING</span>
                </div>

                <h3>Create a meeting</h3>
                <p>
                  Set up a meeting room and invite your team with a unique
                  code.
                </p>

                <form onSubmit={handleCreateMeeting}>
                  <div className="form-group">
                    <label htmlFor="meetingTitle">Meeting title</label>
                    <input
                      id="meetingTitle"
                      type="text"
                      placeholder="e.g. Weekly team sync"
                      value={meetingTitle}
                      onChange={(event) =>
                        setMeetingTitle(event.target.value)
                      }
                      maxLength={120}
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label htmlFor="meetingDescription">
                      Description <span>Optional</span>
                    </label>
                    <textarea
                      id="meetingDescription"
                      placeholder="What would you like to discuss?"
                      value={meetingDescription}
                      onChange={(event) =>
                        setMeetingDescription(event.target.value)
                      }
                      maxLength={500}
                      rows={3}
                    />
                  </div>

                  <button
                    className="submit-button"
                    type="submit"
                    disabled={meetingLoading}
                  >
                    {meetingLoading ? "Please wait..." : "Create meeting"}{" "}
                    <span>→</span>
                  </button>
                </form>
              </section>

              <section className="meeting-action-card join-meeting-card">
                <div className="action-card-heading">
                  <span className="action-icon join-action-icon">↗</span>
                  <span className="action-kicker">JOIN A MEETING</span>
                </div>

                <h3>Have a meeting code?</h3>
                <p>
                  Enter the code shared by your host to join the conversation.
                </p>

                <form onSubmit={handleJoinMeeting}>
                  <div className="form-group join-code-group">
                    <label htmlFor="joinCode">Meeting code</label>
                    <input
                      id="joinCode"
                      type="text"
                      placeholder="Enter your 8-character code"
                      value={joinCode}
                      onChange={(event) =>
                        setJoinCode(event.target.value.toUpperCase())
                      }
                      maxLength={8}
                      required
                    />
                  </div>

                  <button
                    className="submit-button join-submit"
                    type="submit"
                    disabled={meetingLoading}
                  >
                    {meetingLoading ? "Please wait..." : "Join meeting"}{" "}
                    <span>→</span>
                  </button>
                </form>

                <div className="join-hint">
                  <span>ⓘ</span> Ask your host for the meeting code.
                </div>
              </section>
            </div>
          </section>

          {/* AI Assistant */}
          <section className="ai-assistant-section" id="ai-assistant">
            <div className="meetings-heading">
              <div>
                <p className="eyebrow">INTELLIGENT MEETINGS</p>
                <h2>AI Meeting Assistant</h2>
                <p>
                  Turn meeting conversations into clear summaries and
                  actionable tasks.
                </p>
              </div>

              <span className="ai-status-label">✦ AI POWERED</span>
            </div>

            <div className="ai-assistant-card">
              <div className="ai-card-intro">
                <span className="ai-card-icon">✧</span>
                <div>
                  <h3>Analyze your meeting transcript</h3>
                  <p>
                    Paste a meeting transcript below. IntelliMeet AI can
                    summarize the discussion and identify action items.
                  </p>
                </div>
              </div>

              <div className="form-group ai-transcript-group">
                <label htmlFor="meetingTranscript">
                  Meeting transcript
                </label>

                <textarea
                  id="meetingTranscript"
                  className="ai-transcript-input"
                  placeholder="Paste your meeting transcript here...

Example:
Yash: We need to complete the dashboard by Friday.
Rahul: I will test the meeting functionality tomorrow.
Yash: Let's review the final deployment before submission."
                  value={transcript}
                  onChange={(event) => {
                    setTranscript(event.target.value);
                    setAiError("");
                    setAiMessage("");
                  }}
                  maxLength={50000}
                  rows={8}
                />

                <div className="ai-input-footer">
                  <span>{transcript.length.toLocaleString()} / 50,000 characters</span>
                  <span>Minimum 20 characters</span>
                </div>
              </div>

              {aiError && (
                <p className="ai-feedback ai-feedback-error" role="alert">
                  {aiError}
                </p>
              )}

              {aiMessage && (
                <p className="ai-feedback ai-feedback-success" role="status">
                  {aiMessage}
                </p>
              )}

              <div className="ai-action-buttons">
                <button
                  type="button"
                  className="submit-button"
                  onClick={handleGenerateSummary}
                  disabled={aiLoading !== null || transcript.trim().length < 20}
                >
                  {aiLoading === "summary"
                    ? "Generating summary..."
                    : "✧ Generate summary"}
                </button>

                <button
                  type="button"
                  className="submit-button ai-secondary-button"
                  onClick={handleExtractActionItems}
                  disabled={aiLoading !== null || transcript.trim().length < 20}
                >
                  {aiLoading === "actions"
                    ? "Extracting tasks..."
                    : "☑ Extract action items"}
                </button>

                <button
                  type="button"
                  className="logout-button"
                  onClick={handleClearAI}
                  disabled={aiLoading !== null}
                >
                  Clear
                </button>
              </div>
            </div>

            {/* AI summary results */}
            {aiSummary && (
              <article className="ai-result-card">
                <div className="ai-result-heading">
                  <div>
                    <p className="eyebrow">GENERATED INSIGHTS</p>
                    <h3>{aiSummary.title || "Meeting Summary"}</h3>
                  </div>

                  <button
                    type="button"
                    className="logout-button"
                    onClick={() =>
                      handleCopyAIResult(
                        [
                          aiSummary.title,
                          aiSummary.overview,
                          aiSummary.keyPoints?.length
                            ? `Key Points:\n${aiSummary.keyPoints.join("\n")}`
                            : "",
                          aiSummary.decisions?.length
                            ? `Decisions:\n${aiSummary.decisions.join("\n")}`
                            : "",
                          aiSummary.conclusion?.trim()
                            ? `Conclusion:\n${aiSummary.conclusion.trim()}`
                            : "Conclusion:\nThe discussion points above capture the key outcomes. No separate conclusion was provided.",
                        ]
                          .filter((part) => typeof part === "string" && part.trim())
                          .join("\n\n")
                      )
                    }
                  >
                    Copy summary
                  </button>
                </div>

                <div className="ai-result-content">
                  <section>
                    <h4>Overview</h4>
                    <p>{aiSummary.overview || "No overview available."}</p>
                  </section>

                  <section>
                    <h4>Key discussion points</h4>
                    {aiSummary.keyPoints?.length ? (
                      <ul>
                        {aiSummary.keyPoints.map((point, index) => (
                          <li key={index}>{point}</li>
                        ))}
                      </ul>
                    ) : (
                      <p>No key points identified.</p>
                    )}
                  </section>

                  <section>
                    <h4>Decisions made</h4>
                    {aiSummary.decisions?.length ? (
                      <ul>
                        {aiSummary.decisions.map((decision, index) => (
                          <li key={index}>{decision}</li>
                        ))}
                      </ul>
                    ) : (
                      <p>No decisions identified.</p>
                    )}
                  </section>

                  <section>
                    <h4>Conclusion</h4>
                    <p>
                      {aiSummary.conclusion?.trim() ||
                        "The discussion points above capture the key outcomes. No separate conclusion was provided."}
                    </p>
                  </section>
                </div>
              </article>
            )}

            {/* AI action item results */}
            {actionItems !== null && (
              <article className="ai-result-card">
                <div className="ai-result-heading">
                  <div>
                    <p className="eyebrow">TASK MANAGEMENT</p>
                    <h3>Extracted action items</h3>
                  </div>

                  <button
                    type="button"
                    className="logout-button"
                    onClick={() =>
                      handleCopyAIResult(
                        actionItems.length
                          ? actionItems
                              .map(
                                (item, index) =>
                                  `${index + 1}. ${item.task}\nAssignee: ${item.assignee}\nDeadline: ${item.deadline}\nPriority: ${item.priority}`
                              )
                              .join("\n\n")
                          : "No actionable tasks were identified."
                      )
                    }
                  >
                    Copy tasks
                  </button>
                </div>

                {actionItems.length === 0 ? (
                  <p className="ai-empty-result">
                    No actionable tasks were identified in this transcript.
                  </p>
                ) : (
                  <div className="ai-action-items-list">
                    {actionItems.map((item, index) => (
                      <div className="ai-action-item" key={index}>
                        <div className="ai-task-number">{index + 1}</div>

                        <div className="ai-task-content">
                          <h4>{item.task}</h4>
                          <div
                            className="ai-task-meta"
                            style={{
                              display: "flex",
                              flexWrap: "wrap",
                              alignItems: "center",
                              columnGap: "24px",
                              rowGap: "10px",
                              marginTop: "12px",
                            }}
                          >
                            <span>
                              <strong>Assignee:</strong> {item.assignee}
                            </span>
                            <span>
                              <strong>Deadline:</strong> {item.deadline}
                            </span>
                            <span>
                              <strong>Priority:</strong>{" "}
                              <span
                                className={`priority-label ${String(
                                  item.priority
                                ).toLowerCase()}`}
                              >
                                {item.priority}
                              </span>
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </article>
            )}
          </section>

          {/* Meeting history */}
          <section className="meetings-section" id="meetings">
            <div className="meetings-heading">
              <div>
                <p className="eyebrow">YOUR ACTIVITY</p>
                <h2>My meetings</h2>
                <p>All the meeting rooms you've created or joined.</p>
              </div>

              <button
                type="button"
                className="logout-button refresh-button"
                onClick={fetchMeetings}
                disabled={meetingLoading}
              >
                {meetingLoading ? "Refreshing..." : "↻ Refresh"}
              </button>
            </div>

            {meetingLoading && meetings.length === 0 ? (
              <div className="empty-meetings">
                <span className="empty-meeting-icon">◷</span>
                <h3>Loading your meetings</h3>
                <p>Your workspace activity will appear here shortly.</p>
              </div>
            ) : meetings.length === 0 ? (
              <div className="empty-meetings">
                <span className="empty-meeting-icon">▤</span>
                <h3>Your meeting space is ready</h3>
                <p>
                  Create your first meeting or join a room using a meeting
                  code. Your activity will appear here.
                </p>
                <a href="#create-meeting">
                  Start your first meeting <span>→</span>
                </a>
              </div>
            ) : (
              <div className="meetings-list">
                {meetings.map((meeting) => {
                  const hostId =
                    typeof meeting.host === "string"
                      ? meeting.host
                      : meeting.host?._id;

                  const isHost =
                    String(hostId ?? "") === String(user.id);

                  return (
                    <article className="meeting-item" key={meeting._id}>
                      <div className="meeting-item-main">
                        <span className="meeting-item-icon">▤</span>

                        <div className="meeting-item-content">
                          <div className="meeting-title-row">
                            <h3>{meeting.title}</h3>

                            <span
                              className={`meeting-status ${meeting.status}`}
                            >
                              <i />
                              {meeting.status}
                            </span>
                          </div>

                          <p className="meeting-description">
                            {meeting.description ||
                              "No description provided."}
                          </p>

                          <div className="meeting-meta">
                            <span>
                              <b>Code</b> {meeting.meetingCode}
                            </span>

                            <span>
                              <b>Role</b>{" "}
                              {isHost ? "Host" : "Participant"}
                            </span>

                            <span>
                              <b>Created</b>{" "}
                              {new Date(
                                meeting.createdAt
                              ).toLocaleDateString()}
                            </span>

                            {meeting.scheduledAt && (
                              <span>
                                <b>Scheduled</b>{" "}
                                {new Date(
                                  meeting.scheduledAt
                                ).toLocaleString()}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="meeting-buttons">
                        <button
                          type="button"
                          className="submit-button compact-button"
                          onClick={() =>
                            setSelectedMeetingCode(meeting.meetingCode)
                          }
                        >
                          Open room <span>→</span>
                        </button>

                        {meeting.status === "scheduled" && isHost && (
                          <button
                            type="button"
                            className="logout-button compact-button"
                            disabled={
                              activeMeeting === meeting.meetingCode
                            }
                            onClick={() =>
                              handleMeetingAction(
                                meeting.meetingCode,
                                "start"
                              )
                            }
                          >
                            {activeMeeting === meeting.meetingCode
                              ? "Please wait..."
                              : "Start meeting"}
                          </button>
                        )}

                        {meeting.status === "live" && isHost && (
                          <button
                            type="button"
                            className="logout-button end-meeting-button compact-button"
                            disabled={
                              activeMeeting === meeting.meetingCode
                            }
                            onClick={() =>
                              handleMeetingAction(
                                meeting.meetingCode,
                                "end"
                              )
                            }
                          >
                            {activeMeeting === meeting.meetingCode
                              ? "Please wait..."
                              : "End meeting"}
                          </button>
                        )}

                        <button
                          type="button"
                          className="logout-button compact-button"
                          onClick={() => {
                            if (!navigator.clipboard?.writeText) {
                              setDashboardMessage(
                                "Clipboard access is unavailable in this browser."
                              );
                              setDashboardError(true);
                              return;
                            }

                            navigator.clipboard
                              .writeText(meeting.meetingCode)
                              .then(() => {
                                setDashboardMessage("Meeting code copied!");
                                setDashboardError(false);
                              })
                              .catch(() => {
                                setDashboardMessage(
                                  "Unable to copy meeting code. Please copy it manually."
                                );
                                setDashboardError(true);
                              });
                          }}
                        >
                          Copy code
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          <footer className="dashboard-footer">
            <strong>
              IntelliMeet<span>.</span>
            </strong>
            <span>Thoughtful meetings. Better collaboration.</span>
            <span>Signed in as {user.email}</span>
          </footer>
        </div>
      </div>
    </main>
  );
}

export default App;
