import { logDataToFirebase } from './firebase.js';
import { sendTrigger } from './triggers.js';

// Centralized event bus wrapper
export class Logger {
    constructor() {
        this.sessionId = `session_${Date.now()}`;
        this.dataBuffer = [];
        this.participantId = null;
        this.sessionNumber = null;
        this.sessionDocId = null;
    }

    logEvent(eventName, data = {}) {
        const payload = {
            eventName,
            ...data,
            timestamp: performance.now(),
            sessionId: this.sessionId,
            participantId: this.participantId,
            sessionNumber: this.sessionNumber,
            sessionDocId: this.sessionDocId
        };
        
        // Log to console for debugging
        console.log(`[Logger] ${eventName}:`, payload);
        
        // Save to buffer
        this.dataBuffer.push(payload);
        
        // Push to Firebase async (if configured)
        logDataToFirebase("experiment_events", payload);
    }
    
    // Abstract trigger sending via the event bus to keep timeline clean
    dispatchTrigger(triggerValue) {
        this.logEvent('hardware_trigger_sent', { value: triggerValue });
        sendTrigger(triggerValue);
    }
    
    getBuffer() {
        return this.dataBuffer;
    }
}

export const logger = new Logger();
