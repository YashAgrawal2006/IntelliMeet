
import { useCallback, useEffect, useState, type FormEvent } from "react";
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

  // Currently opened meeting room
  const [selectedMeetingCode, setSelectedMeetingCode] = useState<
    string | null
  >(null);

  // Common authenticated API request.
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

  // Fetch meetings belonging to the logged-in user.
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

  // Load meetings after login.
  useEffect(() => {
    if (user) {
      fetchMeetings();
    }
  }, [user, fetchMeetings]);

  // Register or log in.
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

  // Create a new meeting and open its room.
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
        throw new Error("Meeting was created, but no meeting code was returned.");
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

  // Join an existing meeting and open its room.
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
        {
          method: "POST",
        }
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

  // Start or end a meeting from the dashboard.
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
        {
          method: "POST",
        }
      );

      setDashboardMessage(data.message || `Meeting ${action}ed successfully.`);
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

  // Return from the meeting room to the dashboard.
  const handleBackToDashboard = async () => {
    setSelectedMeetingCode(null);
    await fetchMeetings();
  };

  // Called after the host successfully ends a meeting.
  const handleMeetingEnded = async () => {
    setSelectedMeetingCode(null);
    await fetchMeetings();

    setDashboardMessage("Meeting ended successfully.");
    setDashboardError(false);
  };

  // Log out.
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
    setMode("login");
  };

  // Authentication screen.
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

  // Meeting Room screen.
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

  // Dashboard screen.
  return (
    <main className="dashboard">
      <nav className="topbar">
        <h2>
          IntelliMeet<span>.</span>
        </h2>

        <button className="logout-button" onClick={handleLogout}>
          Log out
        </button>
      </nav>

      <section className="welcome-section">
        <p className="eyebrow">YOUR WORKSPACE</p>

        <h1>Welcome back, {user.name}!</h1>

        <p>
          Your meeting and collaboration workspace is ready.
        </p>

        {/* Dashboard feature cards */}
        <div className="dashboard-grid">
          <article className="dashboard-card">
            <span className="card-icon">🎥</span>
            <h3>Meetings</h3>
            <p>Create and join your meetings.</p>
            <span className="coming-soon">Active</span>
          </article>

          <article className="dashboard-card">
            <span className="card-icon">🤖</span>
            <h3>AI Assistant</h3>
            <p>Turn meeting conversations into useful insights.</p>
            <span className="coming-soon">Coming next</span>
          </article>

          <article className="dashboard-card">
            <span className="card-icon">💬</span>
            <h3>Collaboration</h3>
            <p>Work together with your team.</p>
            <span className="coming-soon">Coming next</span>
          </article>
        </div>

        {/* Dashboard messages */}
        {dashboardMessage && (
          <p
            className="status-message"
            role="status"
            style={{
              color: dashboardError ? "#dc2626" : "#2563eb",
              marginTop: "20px",
            }}
          >
            {dashboardMessage}
          </p>
        )}

        {/* Create and join meeting sections */}
        <div className="meeting-actions-grid">
          <section className="meeting-action-card">
            <h2>➕ Create a Meeting</h2>
            <p>
              Create a new meeting and invite participants using its code.
            </p>

            <form onSubmit={handleCreateMeeting}>
              <div className="form-group">
                <label htmlFor="meetingTitle">Meeting title</label>
                <input
                  id="meetingTitle"
                  type="text"
                  placeholder="Enter meeting title"
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
                  Description (optional)
                </label>
                <textarea
                  id="meetingDescription"
                  placeholder="What is this meeting about?"
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
                {meetingLoading ? "Please wait..." : "Create Meeting"}
              </button>
            </form>
          </section>

          <section className="meeting-action-card">
            <h2>🔗 Join a Meeting</h2>
            <p>Enter a meeting code shared by your host.</p>

            <form onSubmit={handleJoinMeeting}>
              <div className="form-group">
                <label htmlFor="joinCode">Meeting code</label>
                <input
                  id="joinCode"
                  type="text"
                  placeholder="e.g. F9F5766D"
                  value={joinCode}
                  onChange={(event) =>
                    setJoinCode(event.target.value.toUpperCase())
                  }
                  maxLength={8}
                  required
                />
              </div>

              <button
                className="submit-button"
                type="submit"
                disabled={meetingLoading}
              >
                {meetingLoading ? "Please wait..." : "Join Meeting"}
              </button>
            </form>
          </section>
        </div>

        {/* Meetings list */}
        <section className="meetings-section">
          <div className="meetings-heading">
            <div>
              <h2>My Meetings</h2>
              <p>Meetings you have created or joined.</p>
            </div>

            <button
              type="button"
              className="logout-button"
              onClick={fetchMeetings}
              disabled={meetingLoading}
            >
              {meetingLoading ? "Refreshing..." : "↻ Refresh"}
            </button>
          </div>

          {meetingLoading && meetings.length === 0 ? (
            <p>Loading your meetings...</p>
          ) : meetings.length === 0 ? (
            <div className="empty-meetings">
              <span>📅</span>
              <h3>No meetings yet</h3>
              <p>
                Create your first meeting or join one using a meeting code.
              </p>
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
                    <div className="meeting-item-header">
                      <div>
                        <h3>{meeting.title}</h3>
                        <p>
                          {meeting.description ||
                            "No description provided."}
                        </p>
                      </div>

                      <span
                        className={`meeting-status ${meeting.status}`}
                      >
                        {meeting.status.toUpperCase()}
                      </span>
                    </div>

                    <div className="meeting-meta">
                      <p>
                        <strong>Meeting code:</strong>{" "}
                        <span>{meeting.meetingCode}</span>
                      </p>

                      <p>
                        <strong>Role:</strong>{" "}
                        {isHost ? "Host" : "Participant"}
                      </p>

                      <p>
                        <strong>Created:</strong>{" "}
                        {new Date(meeting.createdAt).toLocaleDateString()}
                      </p>

                      {meeting.scheduledAt && (
                        <p>
                          <strong>Scheduled:</strong>{" "}
                          {new Date(
                            meeting.scheduledAt
                          ).toLocaleString()}
                        </p>
                      )}
                    </div>

                    <div className="meeting-buttons">
                      <button
                        type="button"
                        className="submit-button"
                        onClick={() =>
                          setSelectedMeetingCode(meeting.meetingCode)
                        }
                      >
                        Open Room
                      </button>

                      {meeting.status === "scheduled" && isHost && (
                        <button
                          type="button"
                          className="submit-button"
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
                            : "Start Meeting"}
                        </button>
                      )}

                      {meeting.status === "live" && isHost && (
                        <button
                          type="button"
                          className="submit-button end-meeting-button"
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
                            : "End Meeting"}
                        </button>
                      )}

                      <button
                        type="button"
                        className="logout-button"
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
                        Copy Code
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <p className="account-info">
          Signed in as {user.email} · Role: {user.role}
        </p>
      </section>
    </main>
  );
}

export default App;
