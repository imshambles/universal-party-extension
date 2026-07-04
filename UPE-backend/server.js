const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

// Configure CORS options
const corsOptions = {
  origin: '*',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type'],
  credentials: true,
  optionSuccessStatus: 200,
};

// Apply CORS to Express
app.use(cors(corsOptions));

// Initialize Socket.IO server with custom options
const io = new Server(server, {
  cors: corsOptions,
  pingTimeout: 60000, // 60s
  pingInterval: 25000, // 25s
});

io.on('connection', (socket) => {
  console.log('New connection:', socket.id);
  socket.data = socket.data || { roomId: null, peerId: null, isPeer: false };

  // Join or update membership in a room
  socket.on('join-room', (roomId, peerId) => {
    console.log(`Attempting to join room: ${roomId} for peer: ${peerId}`);

    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.peerId = peerId;

    console.log(`User ${peerId} joined room ${roomId}`);

    // Notify others that a new peer has connected
    socket.to(roomId).emit('peer-connected', peerId);
    socket.to(roomId).emit('user-connected', peerId);
    
    // Send system message about user joining
    socket.to(roomId).emit('system-message', {
      type: 'user-joined',
      peerId: peerId,
      text: `A user joined the party`
    });

    // Send existing peers to this newly joined peer
    try {
      const room = io.sockets.adapter.rooms.get(roomId);
      const existingPeers = [];
      if (room) {
        for (const sid of room) {
          if (sid === socket.id) continue;
          const s = io.sockets.sockets.get(sid);
          if (s && s.data && s.data.peerId) existingPeers.push(s.data.peerId);
        }
      }
      socket.emit('existing-peers', existingPeers);
      socket.emit('existing-users', existingPeers); // backward-compat
    } catch (e) {
      console.error('Error computing existing users:', e);
    }
  });

  // Common handlers (attached once per socket)
  socket.on('disconnect', (reason) => {
    const { roomId, peerId } = socket.data || {};
    if (!roomId || !peerId) return;
    console.log(`User ${peerId} disconnected from room ${roomId}. Reason: ${reason}`);
    
    socket.to(roomId).emit('peer-disconnected', peerId);
    socket.to(roomId).emit('user-disconnected', peerId);
    
    // Send system message about user leaving
    socket.to(roomId).emit('system-message', {
      type: 'user-left',
      peerId: peerId,
      text: `A user left the party`
    });
  });

  socket.on('error', (error) => {
    console.error('Socket error:', error);
  });

  socket.on('heartbeat', () => {
    console.log('Received heartbeat from', socket.id);
  });

  // Video control events
  socket.on('play-video', (payload) => {
    const { roomId, peerId } = socket.data || {};
    if (!roomId) return;
    const displayName = payload && payload.displayName ? payload.displayName : peerId;
    const time = payload && typeof payload.time === 'number' ? payload.time : undefined;
    console.log(`[SYNC] play-video from ${displayName} at ${time} in room ${roomId}`);
    socket.to(roomId).emit('play-video', { from: peerId, displayName, time });
  });

  socket.on('pause-video', (payload) => {
    const { roomId, peerId } = socket.data || {};
    if (!roomId) return;
    const displayName = payload && payload.displayName ? payload.displayName : peerId;
    const time = payload && typeof payload.time === 'number' ? payload.time : undefined;
    console.log(`[SYNC] pause-video from ${displayName} at ${time} in room ${roomId}`);
    socket.to(roomId).emit('pause-video', { from: peerId, displayName, time });
  });

  socket.on('seek-video', (time, payload) => {
    const { roomId, peerId } = socket.data || {};
    if (!roomId) return;
    const displayName = payload && payload.displayName ? payload.displayName : peerId;
    console.log(`[SYNC] seek-video to ${time} from ${displayName} in room ${roomId}`);
    socket.to(roomId).emit('seek-video', time, { from: peerId, displayName });
  });

  // Text chat relay
  socket.on('chat-message', (payload) => {
    try {
      const { roomId, peerId } = socket.data || {};
      if (!roomId) return;
      const msg = {
        from: peerId,
        text: String((payload && payload.text) || ''),
        displayName: String((payload && payload.displayName) || peerId),
        ts: Date.now(),
      };
      console.log(`[CHAT] ${roomId} ${msg.displayName}: ${msg.text}`);
      socket.to(roomId).emit('chat-message', msg);
    } catch (e) {
      console.error('Error relaying chat message', e);
    }
  });
});

// Start the server on port 3000
server.listen(3000, () => {
  console.log('Signaling server running on port 3000');
});
