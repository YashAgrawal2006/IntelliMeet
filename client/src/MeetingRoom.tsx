import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
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

type ChatMessage = {
  id: string;
  senderId: string;
  senderName: string;
  message: string;
  timestamp: string;
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
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const [screenSharing, setScreenSharing] = useState(false);

  const [onlineUserIds, setOnlineUserIds] = useState<string[]>([]);
  const [socketStatus, setSocketStatus] = useState<
    "connecting" | "connected" | "disconnected" | "error"
  >("connecting");
  const [socketError, setSocketError] = useState("");

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatDraft, setChatDraft] = useState("");
  const [chatError, setChatError] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const chatMessagesEndRef = useRef<HTMLDivElement | null>(null);

  // Meeting audio recording and AI transcription state.
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [transcriptionError, setTranscriptionError] = useState("");
  const [transcriptionNotice, setTranscriptionNotice] = useState("");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingContextRef = useRef<AudioContext | null>(null);
  const recordingDestinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const recordedRemoteStreamIdsRef = useRef<Set<string>>(new Set());

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
      const activeScreenTrack = screenStreamRef.current?.getVideoTracks()[0];
      localStream.getTracks().forEach((track) => {
        if (track.kind === "video" && activeScreenTrack) {
          peerConnection.addTrack(activeScreenTrack, screenStreamRef.current!);
        } else {
          peerConnection.addTrack(track, localStream);
        }
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

    // Receive messages sent by everyone in this meeting room.
    const handleIncomingChatMessage = (message: ChatMessage) => {
      if (!message?.id || !message?.message) return;
      setChatMessages((previous) => {
        if (previous.some((item) => item.id === message.id)) return previous;
        return [...previous, message].slice(-200);
      });
    };

    socket.on("chat:message", handleIncomingChatMessage);

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
      socket.off("chat:message", handleIncomingChatMessage);
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

    if (videoRef.current) {
      videoRef.current.srcObject = screenStream || mediaStream;
    }

    // When devices are enabled after joining, initiate offers
    // to peers already present in the meeting.
    if (mediaStream && socketRef.current?.connected) {
      onlineParticipantsRef.current.forEach((participant) => {
        void createOfferForParticipant(participant.socketId);
      });
    }
  }, [mediaStream]);

  // Keep the local preview in sync when switching between camera and screen.
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = screenStream || mediaStream;
    }
  }, [screenStream, mediaStream]);

  // Add remote participant audio tracks that arrive after recording has started.
  useEffect(() => {
    const destination = recordingDestinationRef.current;
    const context = recordingContextRef.current;
    if (!destination || !context || context.state === "closed") return;

    remoteStreams.forEach((remoteStream, socketId) => {
      if (recordedRemoteStreamIdsRef.current.has(socketId)) return;
      const audioTracks = remoteStream.getAudioTracks().filter((track) => track.readyState === "live");
      if (!audioTracks.length) return;
       try {
        const participantAudio = new MediaStream(audioTracks);
        context.createMediaStreamSource(participantAudio).connect(destination);
        recordedRemoteStreamIdsRef.current.add(socketId);
      } catch (err) {
        console.warn("Unable to add a participant to the active recording:", err);
      }
    });
  }, [remoteStreams]);

  // Release any active screen capture when the room unmounts.
  useEffect(() => {
    return () => {
      screenStreamRef.current?.getTracks().forEach((track) => track.stop());
      screenStreamRef.current = null;
    };
  }, []);

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

  // Start screen sharing by replacing the existing WebRTC video sender track.
  const handleStartScreenShare = async () => {
    setMediaError("");

    if (!mediaStream) {
      setMediaError("Enable your camera and microphone before sharing your screen.");
      return;
    }

    if (!navigator.mediaDevices?.getDisplayMedia) {
      setMediaError("Screen sharing is not supported in this browser. Use a supported browser over HTTPS or localhost.");
      return;
    }

    try {
      const capturedStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 15, max: 30 } },
        audio: false,
      });
      const screenTrack = capturedStream.getVideoTracks()[0];

      if (!screenTrack) {
        capturedStream.getTracks().forEach((track) => track.stop());
        throw new Error("No screen video track was provided by the browser.");
      }

      const replacements: RTCRtpSender[] = [];
      for (const connection of peerConnectionsRef.current.values()) {
        const videoSender = connection.getSenders().find(
          (sender) => sender.track?.kind === "video"
        );
        if (videoSender) {
          await videoSender.replaceTrack(screenTrack);
          replacements.push(videoSender);
        }
      }

      if (peerConnectionsRef.current.size > 0 && replacements.length === 0) {
        capturedStream.getTracks().forEach((track) => track.stop());
        throw new Error("No active video connection is ready for screen sharing. Rejoin the meeting and try again.");
      }

      screenStreamRef.current = capturedStream;
      setScreenStream(capturedStream);
      setScreenSharing(true);

      screenTrack.onended = () => {
        void handleStopScreenShare();
      };
    } catch (err) {
      if (err instanceof DOMException && err.name === "NotAllowedError") return;
      setMediaError(err instanceof Error ? err.message : "Unable to start screen sharing.");
    }
  };

  // Restore the camera track for every participant when sharing stops.
  const handleStopScreenShare = async () => {
    const cameraTrack = mediaStreamRef.current?.getVideoTracks()[0] || null;

    try {
      for (const connection of peerConnectionsRef.current.values()) {
        const videoSender = connection.getSenders().find(
          (sender) => sender.track?.kind === "video" ||
            sender.track === null
        );
        if (videoSender) {
          await videoSender.replaceTrack(cameraTrack);
        }
      }
    } catch (err) {
      console.error("Unable to restore camera after screen sharing:", err);
      setMediaError("Screen sharing stopped, but the camera track could not be restored. Please reconnect your camera.");
    } finally {
      screenStreamRef.current?.getTracks().forEach((track) => track.stop());
      screenStreamRef.current = null;
      setScreenStream(null);
      setScreenSharing(false);
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

  // Start recording a mixed audio track from this device and connected peers.
  const handleStartRecording = async () => {
    setTranscriptionError("");
    setTranscriptionNotice("");

    if (meeting?.status !== "live") {
      setTranscriptionError("Start the meeting before recording.");
      return;
    }

    if (!mediaStream?.getAudioTracks().length) {
      setTranscriptionError("Enable your microphone and devices before recording.");
      return;
    }

    const consent = window.confirm(
      "Start recording this meeting's audio for AI transcription? Make sure every participant has been informed and has agreed before you continue."
    );
    if (!consent) return;

    try {
      if (!window.AudioContext) {
        throw new Error("Audio recording is not supported by this browser.");
      }

      const audioContext = new AudioContext();
      await audioContext.resume();
      const destination = audioContext.createMediaStreamDestination();
      let connectedSources = 0;

      const localAudio = mediaStream.getAudioTracks().filter((track) => track.readyState === "live");
      if (localAudio.length) {
        const localAudioStream = new MediaStream(localAudio);
        audioContext.createMediaStreamSource(localAudioStream).connect(destination);
        connectedSources += 1;
      }

      // Include audio received from every remote WebRTC stream currently connected.
      const recordedRemoteIds = new Set<string>();
      remoteStreams.forEach((remoteStream, socketId) => {
        const audioTracks = remoteStream.getAudioTracks().filter((track) => track.readyState === "live");
        if (audioTracks.length) {
          const remoteAudioStream = new MediaStream(audioTracks);
          audioContext.createMediaStreamSource(remoteAudioStream).connect(destination);
          recordedRemoteIds.add(socketId);
          connectedSources += 1;
        }
      });

      if (!connectedSources || !destination.stream.getAudioTracks().length) {
        await audioContext.close();
        throw new Error("No active meeting audio was found. Check your microphone and participant connections.");
      }

      const preferredMimeType = "audio/webm;codecs=opus";
      const options = MediaRecorder.isTypeSupported(preferredMimeType)
        ? { mimeType: preferredMimeType }
        : undefined;
      const recorder = new MediaRecorder(destination.stream, options);
      recordingChunksRef.current = [];
      recordingContextRef.current = audioContext;
      recordingDestinationRef.current = destination;
      recordedRemoteStreamIdsRef.current = recordedRemoteIds;
      recorderRef.current = recorder;

      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data.size > 0) recordingChunksRef.current.push(event.data);
        const currentSize = recordingChunksRef.current.reduce((total, chunk) => total + chunk.size, 0);
        // Leave headroom below the server's 25 MB upload limit.
        if (currentSize >= 22 * 1024 * 1024 && recorder.state === "recording") {
          setTranscriptionNotice("Recording reached the safe upload limit and has been stopped.");
          recorder.stop();
        }
      };

      recorder.onerror = () => {
        setTranscriptionError("The browser encountered an error while recording audio.");
        setIsRecording(false);
      };

      recorder.onstop = async () => {
        setIsRecording(false);
        setIsTranscribing(true);
        setTranscriptionNotice("Uploading meeting audio and generating the transcript...");

        try {
          const audioBlob = new Blob(recordingChunksRef.current, {
            type: recorder.mimeType || "audio/webm",
          });
          recordingChunksRef.current = [];

          if (!audioBlob.size) {
            throw new Error("The recording is empty. Please record again.");
          }
          if (audioBlob.size > 25 * 1024 * 1024) {
            throw new Error("The audio file exceeds the server's 25 MB upload limit. Record a shorter segment.");
          }

          const token = sessionStorage.getItem("intellimeet_token");
          if (!token) throw new Error("Your session has expired. Please log in again.");

          const formData = new FormData();
          formData.append("audio", audioBlob, `intellimeet-${meetingCode.toLowerCase()}-${Date.now()}.webm`);

          const response = await fetch(`${API_BASE_URL}/transcription`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
            body: formData,
          });
          const data = await response.json();
          if (!response.ok || !data.success) {
            throw new Error(data.message || "Unable to transcribe this recording.");
          }

          setTranscript(typeof data.transcript === "string" ? data.transcript : "");
          setTranscriptionNotice("Transcription completed successfully.");
        } catch (err) {
          setTranscriptionError(err instanceof Error ? err.message : "Unable to transcribe the recording.");
          setTranscriptionNotice("");
        } finally {
          setIsTranscribing(false);
          const context = recordingContextRef.current;
          recordingContextRef.current = null;
          recordingDestinationRef.current = null;
          recordedRemoteStreamIdsRef.current.clear();
          if (context && context.state !== "closed") {
            await context.close().catch(() => undefined);
          }
          recorderRef.current = null;
        }
      };

      recorder.start(1000);
      setIsRecording(true);
      setTranscriptionNotice("Recording is active. Participants should be informed that meeting audio is being recorded.");
    } catch (err) {
      setTranscriptionError(err instanceof Error ? err.message : "Unable to start meeting recording.");
      const context = recordingContextRef.current;
      recordingContextRef.current = null;
      recordingDestinationRef.current = null;
      recordedRemoteStreamIdsRef.current.clear();
      if (context && context.state !== "closed") await context.close().catch(() => undefined);
    }
  };

  const handleStopRecording = () => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  };

  const handleCopyTranscript = async () => {
    try {
      await navigator.clipboard.writeText(transcript);
      setTranscriptionNotice("Transcript copied to clipboard.");
    } catch {
      setTranscriptionError("Unable to copy the transcript. You can select and copy the text manually.");
    }
  };

  // Stop an active recording if the user leaves or the room unmounts.
  useEffect(() => {
    return () => {
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") recorder.stop();
      const context = recordingContextRef.current;
      if (context && context.state !== "closed") void context.close();
    };
  }, []);

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

  // Send a message to all participants in the current meeting.
  const handleSendChatMessage = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const message = chatDraft.trim();
    const socket = socketRef.current;

    if (!message || chatSending) return;
    if (!socket?.connected) {
      setChatError("Chat is unavailable because the real-time connection is offline.");
      return;
    }

    setChatError("");
    setChatSending(true);
    socket.emit(
      "chat:send",
      { message },
      (response: { success: boolean; message?: string }) => {
        setChatSending(false);
        if (!response?.success) {
          setChatError(response?.message || "Unable to send your message.");
          return;
        }
        setChatDraft("");
      }
    );
  };

  useEffect(() => {
    chatMessagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

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

          {isRecording && (
            <div className="recording-live-banner" role="status">
              <span className="recording-pulse" /> Recording is active — meeting audio is being captured for transcription.
            </div>
          )}

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
              {(screenSharing || (mediaStream && cameraEnabled)) ? (
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
                  {screenSharing
                    ? " · 🖥️ Sharing"
                    : !cameraEnabled || !mediaStream
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

          <section className="sidebar-card transcription-card" aria-label="Meeting transcription">
            <div className="sidebar-card-heading">
              <h3>AI transcription</h3>
              <span>{isRecording ? "REC" : "AI"}</span>
            </div>
            <p className="transcription-description">
              Record the meeting audio and convert the conversation into text with AI.
            </p>
            <div className="transcription-actions">
              {!isRecording ? (
                <button
                  type="button"
                  className="transcription-button record-button"
                  onClick={handleStartRecording}
                  disabled={meeting.status !== "live" || isTranscribing || !mediaStream}
                >
                  {isTranscribing ? "Transcribing..." : "● Start recording"}
                </button>
              ) : (
                <button type="button" className="transcription-button stop-recording-button" onClick={handleStopRecording}>
                  ■ Stop & transcribe
                </button>
              )}
            </div>
            {!mediaStream && <p className="transcription-hint">Enable your microphone and devices first.</p>}
            {meeting.status !== "live" && <p className="transcription-hint">Recording is available while the meeting is live.</p>}
            {transcriptionNotice && <p className="transcription-notice" role="status">{transcriptionNotice}</p>}
            {transcriptionError && <p className="transcription-error" role="alert">{transcriptionError}</p>}
            {transcript && (
              <div className="transcript-result">
                <div className="transcript-result-heading">
                  <strong>Meeting transcript</strong>
                  <button type="button" onClick={handleCopyTranscript}>Copy</button>
                </div>
                <textarea aria-label="Generated meeting transcript" value={transcript} readOnly rows={7} />
                <p>Copy this transcript into the AI Assistant on your dashboard to generate a summary and action items.</p>
              </div>
            )}
          </section>

          <section className="sidebar-card meeting-chat-card" aria-label="Meeting chat">
            <div className="sidebar-card-heading meeting-chat-heading">
              <h3>Meeting chat</h3>
              <span>{chatMessages.length}</span>
            </div>

            <div className="meeting-chat-messages" aria-live="polite" aria-relevant="additions">
              {chatMessages.length === 0 ? (
                <p className="meeting-chat-empty">No messages yet. Say hello to your team!</p>
              ) : (
                chatMessages.map((chatMessage) => {
                  const ownMessage = String(chatMessage.senderId) === String(currentUserId);
                  return (
                    <article className={`meeting-chat-message ${ownMessage ? "own-message" : ""}`} key={chatMessage.id}>
                      <div className="meeting-chat-message-meta">
                        <strong>{ownMessage ? "You" : chatMessage.senderName}</strong>
                        <time dateTime={chatMessage.timestamp}>
                          {new Date(chatMessage.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </time>
                      </div>
                      <p>{chatMessage.message}</p>
                    </article>
                  );
                })
              )}
              <div ref={chatMessagesEndRef} />
            </div>

            {chatError && <p className="meeting-chat-error" role="alert">{chatError}</p>}

            <form className="meeting-chat-form" onSubmit={handleSendChatMessage}>
              <input
                type="text"
                value={chatDraft}
                onChange={(event) => setChatDraft(event.target.value)}
                placeholder="Type a message..."
                maxLength={1000}
                aria-label="Type a meeting message"
                disabled={socketStatus !== "connected" || meeting.status === "ended" || chatSending}
              />
              <button type="submit" disabled={!chatDraft.trim() || socketStatus !== "connected" || meeting.status === "ended" || chatSending}>
                {chatSending ? "Sending..." : "Send"}
              </button>
            </form>
            <p className="meeting-chat-footnote">Messages are shared live with everyone in this meeting.</p>
          </section>
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
            className={`meeting-control-button ${screenSharing ? "primary-control" : ""}`}
            onClick={screenSharing ? handleStopScreenShare : handleStartScreenShare}
            disabled={!mediaStream || meeting.status !== "live"}
            title={screenSharing ? "Stop sharing your screen" : "Share your screen"}
          >
            <span>🖥️</span>
            <span>{screenSharing ? "Stop sharing" : "Share screen"}</span>
          </button>

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