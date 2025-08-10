/* global Peer, io, chrome */
// Uses global `io` and `Peer` from libs included in HTML

// Create a new Peer instance with specified server configuration
const peer = new Peer(undefined, {
    host: '0.peerjs.com',
    port: 443,
    secure: true
});

// Connect to the Socket.IO server (deployed)
const socket = io('https://universal-party-extension.onrender.com');

// Object to keep track of connected peers
const peers = {};

let heartbeatInterval;
let roomId, peerId;
let localStream;
let localStreamReady = false;
const pendingCalls = [];
const pendingUserIds = [];

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

// Prepare local media and attach to preview
navigator.mediaDevices.getUserMedia({ video: true, audio: true })
  .then((stream) => {
    localStream = stream;
    localStreamReady = true;
    const lv = document.getElementById('local-video');
    if (lv) {
      lv.srcObject = stream;
      lv.addEventListener('loadedmetadata', () => lv.play());
    }
    // Answer any queued inbound calls
    while (pendingCalls.length) {
      const call = pendingCalls.shift();
      try { answerCall(call); } catch (e) { console.error('Error answering queued call', e); }
    }
    // Connect to any queued user IDs
    while (pendingUserIds.length) {
      const id = pendingUserIds.shift();
      try { connectToNewUser(id); } catch (e) { console.error('Error connecting to queued user', e); }
    }
  })
  .catch((err) => {
    console.error('Failed to get local media', err);
  });

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
        if (!localStreamReady) {
            pendingUserIds.push(userId);
        } else {
            connectToNewUser(userId);
        }
    });

    // On join, get existing users and initiate connections
    socket.on('existing-users', (users) => {
        console.log('Existing users in room:', users);
        users.forEach((uid) => {
            if (uid && uid !== peer.id) connectToNewUser(uid);
        });
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

// Inbound call handler
peer.on('call', (call) => {
    if (!localStreamReady) {
        console.warn('Local stream not ready yet; queueing inbound call');
        pendingCalls.push(call);
        return;
    }
    answerCall(call);
});

function answerCall(call) {
    call.answer(localStream);
    call.on('stream', (userVideoStream) => {
        attachRemoteStream(userVideoStream);
    });
    call.on('close', () => {
        console.log('Inbound call closed');
    });
}

// Function to connect to a new user
function connectToNewUser(userId) {
    if (!localStreamReady) {
        console.warn('No local stream yet, queueing connect');
        pendingUserIds.push(userId);
        return;
    }
    if (peers[userId]) {
        console.log('Already connected to', userId);
        return;
    }
    const call = peer.call(userId, localStream);
    call.on('stream', (userVideoStream) => {
        attachRemoteStream(userVideoStream);
    });
    call.on('close', () => {
        console.log(`Call with ${userId} closed`);
    });
    peers[userId] = call;
}

// Function to add video stream to the DOM
function attachRemoteStream(stream) {
    const rv = document.getElementById('remote-video');
    if (rv) {
        rv.srcObject = stream;
        rv.addEventListener('loadedmetadata', () => rv.play());
        const placeholder = rv.parentElement && rv.parentElement.querySelector('.video-placeholder');
        if (placeholder) placeholder.style.display = 'none';
    } else {
        // Fallback: append a new video
        const video = document.createElement('video');
        video.srcObject = stream;
        video.addEventListener('loadedmetadata', () => video.play());
        video.style.width = '100%';
        document.body.append(video);
    }
}

// Handle window closing
window.addEventListener('beforeunload', () => {
    socket.disconnect();
    peer.destroy();
    clearInterval(heartbeatInterval);

    // Notify the background script that the window is closing
    chrome.runtime.sendMessage({ type: 'video-chat-closed' });
});
