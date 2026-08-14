// Simple encryption for message content (basic obfuscation)
class SimpleCrypto {
    constructor() {
        this.key = 'DARK-CHAT-SECURE-KEY';
    }

    encrypt(text) {
        try {
            // Simple XOR encryption with key
            let result = '';
            for (let i = 0; i < text.length; i++) {
                const charCode = text.charCodeAt(i) ^ this.key.charCodeAt(i % this.key.length);
                result += String.fromCharCode(charCode);
            }
            return btoa(result);
        } catch (error) {
            return text;
        }
    }

    decrypt(encryptedText) {
        try {
            // Decode from base64 and decrypt
            const decoded = atob(encryptedText);
            let result = '';
            for (let i = 0; i < decoded.length; i++) {
                const charCode = decoded.charCodeAt(i) ^ this.key.charCodeAt(i % this.key.length);
                result += String.fromCharCode(charCode);
            }
            return result;
        } catch (error) {
            return encryptedText;
        }
    }
}

const crypto = new SimpleCrypto();
export default crypto;
