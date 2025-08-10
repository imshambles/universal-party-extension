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
    const prevPeerId = socket.data.peerId;
    const prevIsPeer = socket.data.isPeer;

    console.log(`Attempting to join room: ${roomId} for peer: ${peerId}`);

    socket.join(roomId); // idempotent
    socket.data.roomId = roomId;
    socket.data.peerId = peerId;
    socket.data.isPeer = !String(peerId).startsWith('control-');

    console.log(`User ${peerId} joined room ${roomId} (isPeer=${socket.data.isPeer})`);

    // Notify others only when this socket becomes a real peer or peerId changes
    if (socket.data.isPeer && (!prevIsPeer || prevPeerId !== peerId)) {
      socket.to(roomId).emit('peer-connected', peerId);
      socket.to(roomId).emit('user-connected', peerId);

      // Send existing peers to this newly joined peer
      try {
        const room = io.sockets.adapter.rooms.get(roomId);
        const existingPeers = [];
        if (room) {
          for (const sid of room) {
            if (sid === socket.id) continue;
            const s = io.sockets.sockets.get(sid);
            if (s && s.data && s.data.peerId && s.data.isPeer) existingPeers.push(s.data.peerId);
          }
        }
        socket.emit('existing-peers', existingPeers);
        socket.emit('existing-users', existingPeers); // backward-compat
      } catch (e) {
        console.error('Error computing existing users:', e);
      }
    }
  });

  // Common handlers (attached once per socket)
  socket.on('disconnect', (reason) => {
    const { roomId, peerId, isPeer } = socket.data || {};
    if (!roomId || !peerId) return;
    console.log(`User ${peerId} disconnected from room ${roomId}. Reason: ${reason}`);
    if (isPeer) {
      socket.to(roomId).emit('peer-disconnected', peerId);
      socket.to(roomId).emit('user-disconnected', peerId);
    }
  });

  socket.on('error', (error) => {
    console.error('Socket error:', error);
  });

  socket.on('heartbeat', () => {
    console.log('Received heartbeat from', socket.id);
  });

  // Video control events
  socket.on('play-video', () => {
    const { roomId, peerId } = socket.data || {};
    if (!roomId) return;
    console.log(`[SYNC] play-video from peer ${peerId} in room ${roomId}`);
    socket.to(roomId).emit('play-video');
  });

  socket.on('pause-video', () => {
    const { roomId, peerId } = socket.data || {};
    if (!roomId) return;
    console.log(`[SYNC] pause-video from peer ${peerId} in room ${roomId}`);
    socket.to(roomId).emit('pause-video');
  });

  socket.on('seek-video', (time) => {
    const { roomId, peerId } = socket.data || {};
    if (!roomId) return;
    console.log(`[SYNC] seek-video to ${time} from peer ${peerId} in room ${roomId}`);
    socket.to(roomId).emit('seek-video', time);
  });

  // Text chat relay
  socket.on('chat-message', (payload) => {
    try {
      const { roomId, peerId } = socket.data || {};
      if (!roomId) return;
      const msg = {
        from: peerId,
        text: String((payload && payload.text) || ''),
        ts: Date.now(),
      };
      console.log(`[CHAT] ${roomId} ${msg.from}: ${msg.text}`);
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
