// WebRTC configuration and utilities
const rtcConfig = {
    iceServers: [
        {
            urls: 'stun:stun.l.google.com:19302'
        },
        {
            urls: 'stun:stun1.l.google.com:19302'
        }
    ]
};

export function createPeerConnection() {
    return new RTCPeerConnection(rtcConfig);
}

export async function getUserMedia(constraints) {
    try {
        return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (error) {
        console.error('Failed to get media:', error);
        throw error;
    }
}

export function stopStream(stream) {
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
    }
}
