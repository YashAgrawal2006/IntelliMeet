# IntelliMeet – AI-Powered Enterprise Meeting & Collaboration Platform

IntelliMeet is a full-stack meeting and collaboration platform designed to bring team communication and online meetings together in one workspace.

The application currently provides secure user authentication, meeting management, real-time participant presence, and browser-based audio/video communication using WebRTC and Socket.IO.

## Project Overview

IntelliMeet aims to make virtual meetings more organized, interactive, and productive through a unified collaboration experience.

The project is built using the MERN stack, with React and TypeScript on the frontend, Node.js and Express.js on the backend, and MongoDB for data storage.

## Features

### Implemented Features

- User registration and login.
- Secure password hashing using bcrypt.
- JWT-based authentication and protected API routes.
- Meeting creation and management.
- Meeting joining using meeting codes.
- Real-time participant presence using Socket.IO.
- Browser-based audio and video communication using WebRTC.
- Microphone mute/unmute controls.
- Camera on/off controls.
- Meeting start and end functionality.
- MongoDB integration using Mongoose.

### Planned Enhancements

- AI-powered meeting transcription.
- Automatic meeting summaries.
- AI-based action-item extraction.
- In-meeting real-time chat.
- Shared meeting notes.
- Screen sharing and meeting recording.
- Team and project management.
- Meeting analytics and insights.

## Technology Stack

### Frontend
- React 19
- TypeScript
- Vite
- HTML5
- CSS3
- Socket.IO Client

### Backend
- Node.js
- Express.js
- JavaScript
- MongoDB
- Mongoose
- Socket.IO

### Authentication and Security
- JSON Web Tokens (JWT)
- bcryptjs
- Helmet
- CORS

### Real-Time Communication
- WebRTC
- Socket.IO
- STUN server configuration

## Project Architecture

The application follows a client-server architecture.

```text
IntelliMeet/
│
├── client/
│   ├── public/
│   ├── src/
│   │   ├── assets/
│   │   ├── App.tsx
│   │   ├── App.css
│   │   ├── MeetingRoom.tsx
│   │   ├── MeetingRoom.css
│   │   ├── index.css
│   │   └── main.tsx
│   ├── package.json
│   └── vite.config.ts
│
├── server/
│   ├── middleware/
│   │   └── authMiddleware.js
│   ├── models/
│   │   ├── Meeting.js
│   │   └── User.js
│   ├── routes/
│   │   ├── auth.js
│   │   └── meetings.js
│   ├── server.js
│   └── package.json
│
└── .gitignore
```

## How It Works

1. Users register or log in through the React frontend.
2. The frontend communicates with the Express backend through REST APIs.
3. The backend validates credentials and manages authentication using JWT.
4. MongoDB stores user and meeting information.
5. Socket.IO manages real-time meeting-room communication and participant presence.
6. WebRTC establishes peer-to-peer audio and video communication between participants.

## Getting Started

Follow these steps to run IntelliMeet locally.

### Prerequisites

Make sure you have installed:

- Node.js
- npm
- Git
- MongoDB Atlas account or a MongoDB instance
- Visual Studio Code (recommended)

### 1. Clone the Repository

```bash
git clone https://github.com/YashAgrawal2006/IntelliMeet.git
```

Navigate into the project:

```bash
cd IntelliMeet
```

### 2. Install Backend Dependencies

```bash
cd server
npm install
```

### 3. Configure Backend Environment Variables

Create a `.env` file inside the `server` directory.

```env
PORT=5000
MONGODB_URI=your_mongodb_connection_string
JWT_SECRET=your_secure_jwt_secret
CLIENT_URLS=http://localhost:5173,http://localhost:4173
```

Replace the placeholder values with your own MongoDB connection string and a strong JWT secret.

Never commit your `.env` file or expose your credentials publicly.

### 4. Start the Backend

From the `server` directory:

```bash
npm run dev
```

The backend API will run at:

`http://localhost:5000`

### 5. Install Frontend Dependencies

Open another terminal:

```bash
cd client
npm install
```

### 6. Configure Frontend Environment Variables

Create `client/.env.development`:

```env
VITE_API_BASE_URL=http://localhost:5000/api
VITE_SOCKET_URL=http://localhost:5000
```

For local production-preview testing, create `client/.env.production` with the same local URLs.

For an actual cloud deployment, replace these values with your deployed backend's HTTPS URL.

### 7. Start the Frontend

From the `client` directory:

```bash
npm run dev
```

Open the local development URL displayed by Vite, usually:

`http://localhost:5173`

## Production Build

To generate the frontend production build:

```bash
cd client
npm run build
```

To test the production build locally:

```bash
npm run preview
```

The preview is usually available at:

`http://localhost:4173`

## Testing

The following core functionality has been tested in the local production preview:

- User login and authentication.
- Meeting creation and joining.
- Multiple browser-session participation.
- Real-time participant presence.
- Two-way audio and video communication.
- Microphone and camera controls.
- Meeting start and end functionality.

## Security Notes

- Passwords are hashed before being stored.
- Protected API routes use JWT authentication.
- CORS is configured for permitted frontend origins.
- Environment variables are excluded from Git tracking.
- Never publish database credentials, JWT secrets, or other private configuration.

## Future Scope

IntelliMeet is intended to evolve into a more comprehensive enterprise collaboration platform.

Future development will focus on AI-powered meeting intelligence, automated summaries, action-item generation, real-time collaboration tools, and meeting analytics.

## Author

**Yash Agrawal**

GitHub: https://github.com/YashAgrawal2006

Project Repository: https://github.com/YashAgrawal2006/IntelliMeet

---

*IntelliMeet – Meet. Collaborate. Achieve.*