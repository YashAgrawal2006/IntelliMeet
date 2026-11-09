import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { io, type Socket } from "socket.io-client";
import "./MeetingRoom.css";

const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5000/api"
).replace(/\/$/, "");

const SOCKET_URL = (
  import.meta.env.VITE_SOCKET_URL || "http://localhost:5000"
).replace(/\/$/, "");

type Participant = {
  _id: string;
  name: string;
  email: string;
};

type Meeting = {
  _id: string;
  title: string;
  description: string;
  meetingCode: string;
  status: "scheduled" | "live" | "ended";
  host: {
    _id: string;
    name: string;
    email: string;
  } | string;
  participants: Participant[];
};

type MeetingRoomProps = {
  meetingCode: string;
  currentUserId: string;
  onBack: () => void;
  onMeetingEnded: () => void;
};

type OnlineParticipant = {
  userId: string;
  socketId: string;
};

type JoinResponse = {
  success: boolean;
  message: string;
  meetingCode?: string;
  onlineUserIds?: string[];
  onlineParticipants?: OnlineParticipant[];
};

type ParticipantEvent = {
  userId: string;
  socketId: string;
};

function RemoteVideo({ stream }: { stream: MediaStream }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <video
      ref={videoRef}
      className="participant-video"
      autoPlay
      playsInline
    />
  );
}

function MeetingRoom({
  meetingCode,
  currentUserId,
  onBack,
  onMeetingEnded,
}: MeetingRoomProps) {
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [processing, setProcessing] = useState(false);

  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);
  const [mediaError, setMediaError] = useState("");
  const [micEnabled, setMicEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [mediaLoading, setMediaLoading] = useState(false);

  const [onlineUserIds, setOnlineUserIds] = useState<string[]>([]);
  const [socketStatus, setSocketStatus] = useState<
    "connecting" | "connected" | "disconnected" | "error"
  >("connecting");
  const [socketError, setSocketError] = useState("");

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const socketRef = useRef<Socket | null>(null);

  // Store WebRTC peer connections by remote socket ID.
  const peerConnectionsRef = useRef<
    Map<string, RTCPeerConnection>
  >(new Map());

  // Store remote media streams by socket ID.
  const [remoteStreams, setRemoteStreams] = useState<
    Map<string, MediaStream>
  >(new Map());

  // Store connected participants.
  const onlineParticipantsRef = useRef<
    Map<string, OnlineParticipant>
  >(new Map());

  // Queue ICE candidates until the remote description is ready.
  const pendingIceCandidatesRef = useRef<
    Map<string, RTCIceCandidateInit[]>
  >(new Map());

  // Fetch meeting information from the backend.
  const fetchMeeting = useCallback(async () => {
    try {
      setError("");

      const token = sessionStorage.getItem("intellimeet_token");

      if (!token) {
        throw new Error("Please log in again to access this meeting.");
      }

      const response = await fetch(
        `${API_BASE_URL}/meetings/${encodeURIComponent(meetingCode)}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Unable to load meeting.");
      }

      setMeeting(data.meeting);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to load meeting."
      );
    } finally {
      setLoading(false);
    }
  }, [meetingCode]);

  useEffect(() => {
    fetchMeeting();
  }, [fetchMeeting]);

  // Create a WebRTC peer connection for a remote participant.
  const createPeerConnection = (
    remoteSocketId: string
  ): RTCPeerConnection => {
    const existingConnection =
      peerConnectionsRef.current.get(remoteSocketId);

    if (existingConnection) {
      return existingConnection;
    }

    const peerConnection = new RTCPeerConnection({
      iceServers: [
        {
          urls: "stun:stun.l.google.com:19302",
        },
      ],
    });

    // Add local camera and microphone tracks.
    const localStream = mediaStreamRef.current;

    if (localStream) {
      localStream.getTracks().forEach((track) => {
        peerConnection.addTrack(track, localStream);
      });
    }

    // Send discovered ICE candidates to the remote participant.
    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        socketRef.current?.emit("webrtc:ice-candidate", {
          targetSocketId: remoteSocketId,
          candidate: event.candidate.toJSON(),
        });
      }
    };

    // Receive remote audio and video.
    peerConnection.ontrack = (event) => {
      let remoteStream = event.streams[0];

      if (!remoteStream) {
        remoteStream = new MediaStream();
        remoteStream.addTrack(event.track);
      }

      setRemoteStreams((previous) => {
        const updated = new Map(previous);
        updated.set(remoteSocketId, remoteStream);
        return updated;
      });
    };

    // Monitor peer connection status.
    peerConnection.onconnectionstatechange = () => {
      console.log(
        `WebRTC connection (${remoteSocketId}):`,
        peerConnection.connectionState
      );

      if (
        peerConnection.connectionState === "failed" ||
        peerConnection.connectionState === "closed"
      ) {
        setRemoteStreams((previous) => {
          const updated = new Map(previous);
          updated.delete(remoteSocketId);
          return updated;
        });
      }
    };

    peerConnectionsRef.current.set(
      remoteSocketId,
      peerConnection
    );

    return peerConnection;
  };

  // Create and send an offer to a participant.
  // The joining participant initiates the connection to avoid both sides
  // creating offers simultaneously.
  const createOfferForParticipant = async (
    remoteSocketId: string
  ) => {
    const socket = socketRef.current;
    const localStream = mediaStreamRef.current;

    if (!socket || !socket.connected || !localStream) return;

    try {
      const peerConnection = createPeerConnection(remoteSocketId);

      if (peerConnection.signalingState !== "stable") return;

      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);

      socket.emit("webrtc:offer", {
        targetSocketId: remoteSocketId,
        description: peerConnection.localDescription,
      });
    } catch (err) {
      console.error("Unable to create WebRTC offer:", err);
      setMediaError(
        "Unable to establish a video connection with a participant."
      );
    }
  };

  // Connect to Socket.IO and join the authorized meeting room.
  useEffect(() => {
    if (!meeting || meeting.status === "ended") {
      return;
    }

    const token = sessionStorage.getItem("intellimeet_token");

    if (!token) {
      setSocketStatus("error");
      setSocketError(
        "Authentication token not found. Please log in again."
      );
      return;
    }

    setSocketStatus("connecting");
    setSocketError("");

    const socket = io(SOCKET_URL, {
      auth: { token },
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      setSocketStatus("connected");
      setSocketError("");

      socket.emit(
        "meeting:join",
        { meetingCode },
        (response: JoinResponse) => {
          if (!response?.success) {
            setSocketStatus("error");
            setSocketError(
              response?.message ||
                "Unable to join the real-time meeting room."
            );
            return;
          }

          setOnlineUserIds(
            (response.onlineUserIds || []).map(String)
          );

          // Store existing participants for WebRTC.
          const participants = response.onlineParticipants || [];

          onlineParticipantsRef.current = new Map(
            participants
              .filter(
                (participant) => participant.socketId !== socket.id
              )
              .map((participant) => [
                participant.socketId,
                participant,
              ])
          );

          if (mediaStreamRef.current) {
            participants
              .filter(
                (participant) => participant.socketId !== socket.id
              )
              .forEach((participant) => {
                void createOfferForParticipant(participant.socketId);
              });
          }
        }
      );
    });

    socket.on("connect_error", (err) => {
      setSocketStatus("error");
      setSocketError(
        err.message || "Unable to connect to the real-time server."
      );
    });

    socket.on("disconnect", () => {
      setSocketStatus("disconnected");
      setOnlineUserIds([]);

      onlineParticipantsRef.current.clear();
    });

    // Handle a participant joining.
    socket.on(
      "participant:joined",
      (payload: ParticipantEvent) => {
        if (!payload?.userId || !payload?.socketId) return;

        const joinedUserId = String(payload.userId);

        setOnlineUserIds((previous) =>
          previous.includes(joinedUserId)
            ? previous
            : [...previous, joinedUserId]
        );

        onlineParticipantsRef.current.set(payload.socketId, {
          userId: joinedUserId,
          socketId: payload.socketId,
        });

        // Connect to the newly joined peer if local media is enabled.
        if (mediaStreamRef.current) {
          void createOfferForParticipant(payload.socketId);
        }
      }
    );

    // Handle a participant leaving.
    socket.on(
      "participant:left",
      (payload: ParticipantEvent) => {
        if (!payload?.userId || !payload?.socketId) return;

        const leftUserId = String(payload.userId);

        setOnlineUserIds((previous) =>
          previous.filter((id) => id !== leftUserId)
        );

        onlineParticipantsRef.current.delete(payload.socketId);
        pendingIceCandidatesRef.current.delete(payload.socketId);

        const peerConnection =
          peerConnectionsRef.current.get(payload.socketId);

        if (peerConnection) {
          peerConnection.close();
          peerConnectionsRef.current.delete(payload.socketId);
        }

        setRemoteStreams((previous) => {
          const updated = new Map(previous);
          updated.delete(payload.socketId);
          return updated;
        });
      }
    );

    // Handle an incoming offer and return an answer.
    socket.on(
      "webrtc:offer",
      async (payload: {
        fromSocketId: string;
        description: RTCSessionDescriptionInit;
      }) => {
        if (!payload?.fromSocketId || !payload?.description) return;

        try {
          const peerConnection = createPeerConnection(
            payload.fromSocketId
          );

          await peerConnection.setRemoteDescription(
            new RTCSessionDescription(payload.description)
          );

          const queuedCandidates =
            pendingIceCandidatesRef.current.get(
              payload.fromSocketId
            ) || [];

          for (const candidate of queuedCandidates) {
            await peerConnection.addIceCandidate(
              new RTCIceCandidate(candidate)
            );
          }

          pendingIceCandidatesRef.current.delete(
            payload.fromSocketId
          );

          const answer = await peerConnection.createAnswer();
          await peerConnection.setLocalDescription(answer);

          socket.emit("webrtc:answer", {
            targetSocketId: payload.fromSocketId,
            description: peerConnection.localDescription,
          });
        } catch (err) {
          console.error("Unable to process WebRTC offer:", err);
          setMediaError(
            "A participant's video connection could not be established."
          );
        }
      }
    );

    // Apply the answer to the offer created by this client.
    socket.on(
      "webrtc:answer",
      async (payload: {
        fromSocketId: string;
        description: RTCSessionDescriptionInit;
      }) => {
        if (!payload?.fromSocketId || !payload?.description) return;

        const peerConnection =
          peerConnectionsRef.current.get(payload.fromSocketId);

        if (!peerConnection) return;

        try {
          await peerConnection.setRemoteDescription(
            new RTCSessionDescription(payload.description)
          );

          const queuedCandidates =
            pendingIceCandidatesRef.current.get(
              payload.fromSocketId
            ) || [];

          for (const candidate of queuedCandidates) {
            await peerConnection.addIceCandidate(
              new RTCIceCandidate(candidate)
            );
          }

          pendingIceCandidatesRef.current.delete(
            payload.fromSocketId
          );
        } catch (err) {
          console.error("Unable to process WebRTC answer:", err);
        }
      }
    );

    // Add ICE candidates immediately when possible,
    // otherwise queue them until the remote description is ready.
    socket.on(
      "webrtc:ice-candidate",
      async (payload: {
        fromSocketId: string;
        candidate: RTCIceCandidateInit;
      }) => {
        if (!payload?.fromSocketId || !payload?.candidate) return;

        const peerConnection =
          peerConnectionsRef.current.get(payload.fromSocketId);

        if (!peerConnection || !peerConnection.remoteDescription) {
          const queued =
            pendingIceCandidatesRef.current.get(
              payload.fromSocketId
            ) || [];

          queued.push(payload.candidate);

          pendingIceCandidatesRef.current.set(
            payload.fromSocketId,
            queued
          );

          return;
        }

        try {
          await peerConnection.addIceCandidate(
            new RTCIceCandidate(payload.candidate)
          );
        } catch (err) {
          console.error("Unable to add ICE candidate:", err);
        }
      }
    );

    // Clean up the socket and peer connections.
    return () => {
      socket.emit("meeting:leave");
      socket.disconnect();

      if (socketRef.current === socket) {
        socketRef.current = null;
      }

      peerConnectionsRef.current.forEach((connection) =>
        connection.close()
      );

      peerConnectionsRef.current.clear();
      pendingIceCandidatesRef.current.clear();
      onlineParticipantsRef.current.clear();

      setRemoteStreams(new Map());
      setOnlineUserIds([]);
    };
  }, [meetingCode, meeting?._id, meeting?.status]);

  // Keep the latest local stream available to peer-connection callbacks.
  useEffect(() => {
    mediaStreamRef.current = mediaStream;

    if (videoRef.current && mediaStream) {
      videoRef.current.srcObject = mediaStream;
    }

    // When devices are enabled after joining, initiate offers
    // to peers already present in the meeting.
    if (mediaStream && socketRef.current?.connected) {
      onlineParticipantsRef.current.forEach((participant) => {
        void createOfferForParticipant(participant.socketId);
      });
    }
  }, [mediaStream]);

  // Release camera and microphone when the room unmounts.
  useEffect(() => {
    return () => {
      mediaStream?.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    };
  }, [mediaStream]);

  // Enable camera and microphone.
  const handleEnableDevices = async () => {
    setMediaError("");

    if (!navigator.mediaDevices?.getUserMedia) {
      setMediaError(
        "Camera and microphone access is unavailable. Use localhost or HTTPS in a supported browser."
      );
      return;
    }

    setMediaLoading(true);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });

      setMediaStream(stream);
      setMicEnabled(true);
      setCameraEnabled(true);
    } catch (err) {
      if (err instanceof DOMException) {
        if (err.name === "NotAllowedError") {
          setMediaError(
            "Camera or microphone permission was denied. Allow access in your browser settings."
          );
        } else if (err.name === "NotFoundError") {
          setMediaError(
            "No camera or microphone was found on this device."
          );
        } else if (err.name === "NotReadableError") {
          setMediaError(
            "Your camera or microphone may already be in use by another application."
          );
        } else {
          setMediaError(
            err.message || "Unable to access your devices."
          );
        }
      } else {
        setMediaError(
          "Unable to access your camera and microphone."
        );
      }
    } finally {
      setMediaLoading(false);
    }
  };

  // Toggle microphone.
  const handleMicToggle = () => {
    if (!mediaStream) return;

    const audioTrack = mediaStream.getAudioTracks()[0];
    if (!audioTrack) return;

    const nextState = !micEnabled;
    audioTrack.enabled = nextState;
    setMicEnabled(nextState);
  };

  // Toggle camera.
  const handleCameraToggle = () => {
    if (!mediaStream) return;

    const videoTrack = mediaStream.getVideoTracks()[0];
    if (!videoTrack) return;

    const nextState = !cameraEnabled;
    videoTrack.enabled = nextState;
    setCameraEnabled(nextState);
  };

  // Start or end the meeting.
  const handleMeetingAction = async (
    action: "start" | "end"
  ) => {
    if (action === "end") {
      const confirmed = window.confirm(
        "Are you sure you want to end this meeting?"
      );

      if (!confirmed) return;
    }

    setProcessing(true);
    setError("");

    try {
      const token = sessionStorage.getItem("intellimeet_token");

      if (!token) {
        throw new Error("Please log in again.");
      }

      const response = await fetch(
        `${API_BASE_URL}/meetings/${encodeURIComponent(meetingCode)}/${action}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.message || `Unable to ${action} meeting.`
        );
      }

      if (action === "end") {
        onMeetingEnded();
        return;
      }

      await fetchMeeting();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : `Unable to ${action} meeting.`
      );
    } finally {
      setProcessing(false);
    }
  };

  // Copy meeting code.
  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(meetingCode);
    } catch {
      setError(
        "Unable to copy the meeting code. Please copy it manually."
      );
    }
  };

  // Loading screen.
  if (loading) {
    return (
      <main className="meeting-room-shell">
        <p className="room-loading">Loading your meeting...</p>
      </main>
    );
  }

  // Error screen.
  if (error && !meeting) {
    return (
      <main className="meeting-room-shell">
        <div className="room-error">
          <h2>Unable to open meeting</h2>
          <p>{error}</p>

          <button className="room-button" onClick={onBack}>
            Back to Dashboard
          </button>
        </div>
      </main>
    );
  }

  if (!meeting) return null;

  const hostId =
    typeof meeting.host === "string"
      ? meeting.host
      : meeting.host._id;

  const isHost = String(hostId) === String(currentUserId);

  const hostName =
    typeof meeting.host === "string"
      ? "Meeting host"
      : meeting.host.name;

  const participants = meeting.participants || [];

  const isUserOnline = (userId: string) =>
    onlineUserIds.includes(String(userId));

  return (
    <main className="meeting-room-shell">
      {/* Meeting header */}
      <header className="meeting-header">
        <div className="meeting-brand">
          IntelliMeet<span>.</span>
        </div>

        <div className="meeting-header-details">
          <h1>{meeting.title}</h1>

          <button
            type="button"
            className="meeting-code-button"
            onClick={handleCopyCode}
            title="Copy meeting code"
          >
            <span>{meeting.meetingCode}</span>
            <span aria-hidden="true">▢</span>
          </button>
        </div>

        <div className="meeting-header-right">
          <span className={`room-live-status ${meeting.status}`}>
            <span className="status-dot" />
            {meeting.status.toUpperCase()}
          </span>

          <button
            type="button"
            className="exit-room-button"
            onClick={onBack}
          >
            Leave room
          </button>
        </div>
      </header>

      {/* Main meeting workspace */}
      <section className="meeting-workspace">
        <div className="meeting-stage-area">
          <div className="meeting-stage-heading">
            <div>
              <span className="stage-eyebrow">
                VIDEO CONFERENCE
              </span>
              <h2>Meeting room</h2>
            </div>

            <span className="participant-count">
              <span aria-hidden="true">👥</span>
              {participants.length} participant
              {participants.length !== 1 ? "s" : ""}
            </span>
          </div>

          {error && (
            <p className="room-alert" role="alert">
              {error}
            </p>
          )}

          {mediaError && (
            <p className="room-alert" role="alert">
              {mediaError}
            </p>
          )}

          {socketError && (
            <p className="room-alert" role="alert">
              Real-time connection: {socketError}
            </p>
          )}

          {/* Participant video gallery */}
          <div className="participant-grid">
            {/* Local participant */}
            <article className="participant-tile local-participant">
              {mediaStream && cameraEnabled ? (
                <video
                  ref={videoRef}
                  className="participant-video"
                  autoPlay
                  playsInline
                  muted
                />
              ) : (
                <div className="participant-placeholder">
                  <div className="participant-avatar-large">
                    👤
                  </div>

                  <span>
                    {mediaStream
                      ? "Camera is off"
                      : "Camera preview is not enabled"}
                  </span>
                </div>
              )}

              <div className="participant-tile-footer">
                <span className="participant-name">
                  {isHost ? "You (Host)" : "You"}
                </span>

                <span className="participant-device-status">
                  {micEnabled && mediaStream ? "🎙️" : "🔇"}
                  {!cameraEnabled || !mediaStream
                    ? " · 📷 Off"
                    : " · 📷"}
                </span>
              </div>

              <span className="you-indicator">YOU</span>
            </article>

            {/* Other meeting participants */}
            {participants
              .filter(
                (participant) =>
                  String(participant._id) !== String(currentUserId)
              )
              .map((participant) => {
                const online = isUserOnline(participant._id);

                return (
                  <article
                    className="participant-tile remote-placeholder-tile"
                    key={participant._id}
                  >
                    {(() => {
                      const participantSocket = Array.from(
                        onlineParticipantsRef.current.values()
                      ).find(
                        (entry) =>
                          entry.userId === String(participant._id)
                      );

                      const remoteStream = participantSocket
                        ? remoteStreams.get(participantSocket.socketId)
                        : undefined;

                      return remoteStream ? (
                        <RemoteVideo stream={remoteStream} />
                      ) : (
                        <div className="participant-placeholder">
                          <div className="participant-avatar-large">
                            👤
                          </div>

                          <span>{participant.name}</span>

                          <small>
                            {online
                              ? "Connected — waiting for media"
                              : "Waiting to join"}
                          </small>
                        </div>
                      );
                    })()}

                    <div className="participant-tile-footer">
                      <span className="participant-name">
                        {participant.name}
                      </span>

                      <span className="participant-device-status">
                        {online ? "🟢 Online" : "⚪ Offline"}
                      </span>
                    </div>
                  </article>
                );
              })}
          </div>

          {meeting.status === "scheduled" && (
            <div className="meeting-notice">
              Waiting for the host to start this meeting.
            </div>
          )}

          {meeting.status === "ended" && (
            <div className="meeting-notice ended-notice">
              This meeting has ended.
            </div>
          )}
        </div>

        {/* Right sidebar */}
        <aside className="meeting-sidebar">
          <div className="sidebar-card">
            <div className="sidebar-card-heading">
              <h3>People</h3>
              <span>{participants.length}</span>
            </div>

            <div className="sidebar-participant-list">
              {participants.map((participant) => {
                const isCurrentUser =
                  String(participant._id) === String(currentUserId);

                const online = isCurrentUser
                  ? socketStatus === "connected"
                  : isUserOnline(participant._id);

                return (
                  <div
                    className="sidebar-participant"
                    key={participant._id}
                  >
                    <div className="sidebar-avatar">
                      {participant.name.charAt(0).toUpperCase()}
                    </div>

                    <div className="sidebar-participant-info">
                      <strong>
                        {isCurrentUser ? "You" : participant.name}
                      </strong>

                      <span>
                        {String(participant._id) === String(hostId)
                          ? "Meeting host"
                          : "Participant"}
                        {" · "}
                        {online ? "Online" : "Offline"}
                      </span>
                    </div>

                    <span
                      className={`participant-online-indicator ${
                        online ? "online" : "offline"
                      }`}
                      title={online ? "Online" : "Offline"}
                    />

                    {String(participant._id) === String(hostId) && (
                      <span className="sidebar-host-badge">
                        Host
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="sidebar-card meeting-details-card">
            <h3>Meeting details</h3>

            <div className="detail-row">
              <span>Meeting code</span>
              <strong>{meeting.meetingCode}</strong>
            </div>

            <div className="detail-row">
              <span>Host</span>
              <strong>{hostName}</strong>
            </div>

            <div className="detail-row">
              <span>Your role</span>
              <strong>{isHost ? "Host" : "Participant"}</strong>
            </div>

            <div className="detail-row">
              <span>Status</span>
              <strong className="capitalize">
                {meeting.status}
              </strong>
            </div>

            <div className="detail-row">
              <span>Real-time connection</span>
              <strong className="capitalize">
                {socketStatus}
              </strong>
            </div>
          </div>
        </aside>
      </section>

      {/* Bottom meeting control dock */}
      <footer className="meeting-control-bar">
        <div className="control-bar-left">
          <span className="control-meeting-title">
            {meeting.title}
          </span>

          <span className="control-meeting-code">
            Code: {meeting.meetingCode}
          </span>
        </div>

        <div className="meeting-control-actions">
          {!mediaStream && meeting.status !== "ended" && (
            <button
              type="button"
              className="meeting-control-button primary-control"
              onClick={handleEnableDevices}
              disabled={mediaLoading}
            >
              <span>🎥</span>
              <span>
                {mediaLoading
                  ? "Connecting..."
                  : "Enable devices"}
              </span>
            </button>
          )}

          <button
            type="button"
            className={`meeting-control-button ${
              !micEnabled ? "control-disabled" : ""
            }`}
            onClick={handleMicToggle}
            disabled={!mediaStream || meeting.status === "ended"}
            title={micEnabled ? "Mute microphone" : "Unmute microphone"}
          >
            <span>{micEnabled ? "🎙️" : "🔇"}</span>
            <span>{micEnabled ? "Mute" : "Unmute"}</span>
          </button>

          <button
            type="button"
            className={`meeting-control-button ${
              !cameraEnabled ? "control-disabled" : ""
            }`}
            onClick={handleCameraToggle}
            disabled={!mediaStream || meeting.status === "ended"}
            title={
              cameraEnabled ? "Turn camera off" : "Turn camera on"
            }
          >
            <span>{cameraEnabled ? "📷" : "🚫"}</span>
            <span>
              {cameraEnabled ? "Stop video" : "Start video"}
            </span>
          </button>

          {isHost && meeting.status === "scheduled" && (
            <button
              type="button"
              className="meeting-control-button start-control"
              onClick={() => handleMeetingAction("start")}
              disabled={processing}
            >
              <span>▶</span>
              <span>
                {processing ? "Starting..." : "Start meeting"}
              </span>
            </button>
          )}

          {isHost && meeting.status === "live" && (
            <button
              type="button"
              className="meeting-control-button end-control"
              onClick={() => handleMeetingAction("end")}
              disabled={processing}
            >
              <span>☎</span>
              <span>
                {processing ? "Ending..." : "End meeting"}
              </span>
            </button>
          )}
        </div>

        <div className="control-bar-right">
          <button
            type="button"
            className="leave-control"
            onClick={onBack}
          >
            Leave
          </button>
        </div>
      </footer>
    </main>
  );
}

export default MeetingRoom;