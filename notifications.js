export async function requestNotificationPermission() {
    if ('Notification' in window) {
        try {
            const permission = await Notification.requestPermission();
            return permission === 'granted';
        } catch (error) {
            console.error('Notification permission error:', error);
            return false;
        }
    }
    return false;
}

export function showNotification(title, body, options = {}) {
    if ('Notification' in window && Notification.permission === 'granted') {
        const notification = new Notification(`🔔 ${title}`, {
            body: body,
            icon: '/icons/icon-192x192.png',
            badge: '/icons/icon-192x192.png',
            ...options
        });
        
        notification.onclick = () => {
            window.focus();
            notification.close();
        };
        
        return notification;
    }
    return null;
}

export function playNotificationSound() {
    // Create simple beep sound using AudioContext
    try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        oscillator.frequency.value = 880;
        oscillator.type = 'sine';
        
        gainNode.gain.setValueAtTime(0.5, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
        
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.5);
        
        // Play twice for notification effect
        setTimeout(() => {
            oscillator.start(audioContext.currentTime + 0.2);
            oscillator.stop(audioContext.currentTime + 0.7);
        }, 200);
        
    } catch (error) {
        console.log('Audio notification not supported');
    }
}
