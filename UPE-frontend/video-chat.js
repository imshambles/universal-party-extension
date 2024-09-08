import io from 'socket.io-client';

// Create a new Peer instance with specified server configuration
const peer = new Peer(undefined, {
    host: '0.peerjs.com',
    port: 443,
    secure: true
});

// Connect to the Socket.IO server
const socket = io('http://localhost:3000');

// Object to keep track of connected peers
const peers = {};

let heartbeatInterval;
let roomId, peerId;

// Function to get URL parameters
function getUrlParameter(name) {
    name = name.replace(/[\[]/, '\\[').replace(/[\]]/, '\\]');
    const regex = new RegExp('[\\?&]' + name + '=([^&#]*)');
    const results = regex.exec(location.search);
    return results === null ? '' : decodeURIComponent(results[1].replace(/\+/g, ' '));
}

// Get roomId and peerId from URL parameters
roomId = getUrlParameter('roomId');
peerId = getUrlParameter('peerId');

// Check if roomId and peerId are properly retrieved
if (!roomId || !peerId) {
    console.error('Missing roomId or peerId in URL parameters!');
    alert('Error: Missing roomId or peerId in URL parameters.');
    throw new Error('Missing roomId or peerId');
}

// When the PeerJS instance is open
peer.on('open', (id) => {
    console.log('PeerJS connection opened with ID:', id);

    console.log('Joining room:', roomId, 'with peer ID:', peerId);

    // Join the room with Socket.IO
    socket.emit('join-room', String(roomId), id);

    // Set up heartbeat
    heartbeatInterval = setInterval(() => {
        if (socket.connected) {
            socket.emit('heartbeat');
            console.log('Heartbeat sent');
        } else {
            console.log('Not connected, skipping heartbeat');
            clearInterval(heartbeatInterval);
        }
    }, 5000);

    // Listen for other users connecting
    socket.on('user-connected', (userId) => {
        console.log('New user connected:', userId);
        connectToNewUser(userId);
    });

    // Listen for users disconnecting
    socket.on('user-disconnected', (userId) => {
        console.log('User disconnected:', userId);
        if (peers[userId]) {
            peers[userId].close();
            delete peers[userId];
        }
    });
});

// Function to connect to a new user
function connectToNewUser(userId) {
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
        .then((stream) => {
            const call = peer.call(userId, stream);
            call.on('stream', (userVideoStream) => {
                addVideoStream(userVideoStream);
            });
            call.on('close', () => {
                console.log(`Call with ${userId} closed`);
            });
            peers[userId] = call;
        })
        .catch((err) => {
            console.error('Failed to get local stream', err);
        });
}

// Function to add video stream to the DOM
function addVideoStream(stream) {
    const video = document.createElement('video');
    video.srcObject = stream;
    video.addEventListener('loadedmetadata', () => {
        video.play();
    });
    video.style.width = '100%'; // Optional: Style video
    document.body.append(video);
}

// Handle window closing
window.addEventListener('beforeunload', (event) => {
    socket.disconnect();
    peer.destroy();
    clearInterval(heartbeatInterval);

    // Notify the background script that the window is closing
    chrome.runtime.sendMessage({ type: 'video-chat-closed' });
});
