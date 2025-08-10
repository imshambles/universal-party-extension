// background.js

// Log when the extension is installed or updated
chrome.runtime.onInstalled.addListener(() => {
  console.log('Party Extension installed or updated');
});

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Received message:', message);
  // No window popups anymore; content scripts inject sidebar overlays directly
  return true;
});

// Keep the service worker alive
chrome.runtime.onConnect.addListener(function(port) {
  port.onDisconnect.addListener(function() {
    chrome.runtime.reload();
  });
});