const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

// Configure CORS options
const corsOptions = {
    origin: "*",
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"],
    credentials: true,
    optionSuccessStatus:200
};
const debug = require('debug')('socket.io:server');

// Initialize Socket.IO server with custom options
const io = new Server(server, {
    cors: corsOptions,
    pingTimeout: 60000, // Increase ping timeout to 60 seconds
    pingInterval: 25000 // Ping every 25 seconds
});

// Serve static files from the "public" directory
app.use(express.static('public'));

// Handle Socket.IO connections
io.on('connection', (socket) => {
    console.log('New connection:', socket.id);

    // Handle joining a room
    socket.on('join-room', (roomId, peerId) => {
        console.log(`Attempting to join room: ${roomId} for peer: ${peerId}`);
        socket.join(roomId);
        console.log(`User ${peerId} joined room ${roomId}`);
        socket.to(roomId).emit('user-connected', peerId);

        // Handle user disconnection
        socket.on('disconnect', (reason) => {
            console.log(`User ${peerId} disconnected from room ${roomId}. Reason: ${reason}`);
            console.log('Socket details:', socket.id, socket.connected, socket.disconnected);
            socket.to(roomId).emit('user-disconnected', peerId);
        });

        // Handle socket errors
        socket.on('error', (error) => {
            console.error('Socket error:', error);
        });

        // Handle heartbeat from clients
        socket.on('heartbeat', () => {
            console.log('Received heartbeat from', socket.id);
        });

        // Handle video control events
        socket.on('play-video', () => {
            socket.to(roomId).emit('play-video');
        });

        socket.on('pause-video', () => {
            socket.to(roomId).emit('pause-video');
        });

        socket.on('seek-video', (time) => {
            socket.to(roomId).emit('seek-video', time);
        });
    });
});

// Start the server on port 3000
server.listen(3000, () => {
    console.log('Signaling server running on port 3000');
});
