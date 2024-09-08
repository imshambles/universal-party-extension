import io from 'socket.io-client';
const socket = io('http://localhost:3000');
let roomId;
let peerId;

document.getElementById('createRoom').addEventListener('click', () => {
    // Generate a unique room ID
    roomId = Math.random().toString(36).substring(2, 15);
    document.getElementById('roomId').textContent = `Room ID: ${roomId}`;
    
    // Notify the user about the room ID
    alert(`Room created! Share this Room ID with others: ${roomId}`);
});

document.getElementById('joinRoom').addEventListener('click', () => {
    roomId = prompt("Enter the Room ID to join:");
    if (roomId) {
        peerId = Math.random().toString(36).substring(2, 15);
        socket.emit('join-room', String(roomId), peerId);
        alert(`Joined Room ID: ${roomId}`);
    }
});

document.getElementById('startVideoChat').addEventListener('click', () => {
    // Start the video chat
    startVideoChat();
});

function startVideoChat() {
    // Pass the roomId and peerId as URL parameters
    const videoChatUrl = `video-chat.html?roomId=${roomId}&peerId=${peerId}`;
    window.open(videoChatUrl, '_blank', 'width=600,height=400');
}
