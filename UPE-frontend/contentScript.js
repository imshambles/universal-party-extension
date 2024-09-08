// contentScript.js
import io from 'socket.io-client';
let socket;
let roomId;
let peerId;

// Function to initialize Socket.IO connection
function initializeSocket() {
    socket = io('http://localhost:3000');

    socket.on('connect', () => {
        console.log('Connected to Socket.IO server');
        joinRoom();
    });

    socket.on('connect_error', (error) => {
        console.error('Socket.IO connection error:', error);
    });

    // Listen for sync events
    socket.on('play-video', () => {
        const video = document.querySelector('video');
        if (video) video.play();
    });

    socket.on('pause-video', () => {
        const video = document.querySelector('video');
        if (video) video.pause();
    });

    socket.on('seek-video', (time) => {
        const video = document.querySelector('video');
        if (video) video.currentTime = time;
    });
}

// Function to join or create a room
function joinRoom() {
    if (roomId && peerId) {
        console.log(`Joining room ${roomId} with peer ID ${peerId}`);
        socket.emit('join-room', roomId, peerId);
        setupVideoListeners();
    }
}

// Function to set up video event listeners
function setupVideoListeners() {
    const video = document.querySelector('video');
    if (video) {
        video.addEventListener('play', () => {
            socket.emit('play-video', roomId);
        });

        video.addEventListener('pause', () => {
            socket.emit('pause-video', roomId);
        });

        video.addEventListener('seeked', () => {
            socket.emit('seek-video', roomId, video.currentTime);
        });
    }
}

// Function to open video chat window
function openVideoChatWindow() {
    chrome.runtime.sendMessage({
        type: 'video-chat',
        roomId: roomId,
        peerId: peerId
    }, (response) => {
        if (chrome.runtime.lastError) {
            console.error('Error opening video chat:', chrome.runtime.lastError);
        } else {
            console.log('Video chat window opened');
        }
    });
}

// Main initialization
chrome.storage.local.get(['roomId', 'peerId'], (result) => {
    if (result.roomId && result.peerId) {
        roomId = result.roomId;
        peerId = result.peerId;
        initializeSocket();
    } else {
        roomId = prompt("Enter Room ID to join or create:");
        if (roomId) {
            peerId = Math.random().toString(36).substring(2, 15);
            chrome.storage.local.set({ roomId, peerId }, () => {
                initializeSocket();
            });
        }
    }
});

// Add a button to open video chat
const chatButton = document.createElement('button');
chatButton.textContent = 'Open Video Chat';
chatButton.style.position = 'fixed';
chatButton.style.top = '10px';
chatButton.style.right = '10px';
chatButton.style.zIndex = '9999';
chatButton.addEventListener('click', openVideoChatWindow);
document.body.appendChild(chatButton);