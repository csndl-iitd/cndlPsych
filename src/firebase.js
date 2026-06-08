import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, query, where, doc, updateDoc } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";

let app;
let db;
let enableFirestore = true;

export function initFirebase(config) {
    enableFirestore = config && config.enableFirestore !== false;
    if (!enableFirestore) {
        console.log("Firestore recording is disabled (Local-only mode).");
        db = null;
        return true;
    }
    try {
        app = initializeApp(config);
        db = getFirestore(app);
        return true;
    } catch (error) {
        console.error("Firebase initialization error:", error);
        return false;
    }
}

export function isFirestoreEnabled() {
    return !!(db && enableFirestore);
}

export async function logDataToFirebase(collectionName, data) {
    if (!db) {
        console.warn("Firebase not initialized. Data not logged to cloud.");
        return false;
    }
    try {
        const docRef = await addDoc(collection(db, collectionName), {
            ...data,
            timestamp: new Date().toISOString()
        });
        return docRef.id;
    } catch (e) {
        console.error("Error adding document: ", e);
        return false;
    }
}

export async function getNextParticipantId() {
    if (!db) return "001";
    try {
        const querySnapshot = await getDocs(collection(db, "participants"));
        let maxId = 0;
        querySnapshot.forEach((doc) => {
            const data = doc.data();
            const pId = data.participant_id;
            if (pId && typeof pId === 'string' && pId.startsWith("sub-")) {
                const numStr = pId.substring(4);
                const num = parseInt(numStr, 10);
                if (!isNaN(num) && num > maxId) {
                    maxId = num;
                }
            }
        });
        const nextId = maxId + 1;
        return String(nextId).padStart(3, '0');
    } catch (error) {
        console.error("Error fetching next participant ID:", error);
        return "001";
    }
}

export async function getNextSessionNumber(participantId) {
    if (!db || !participantId) return "01";
    try {
        const q = query(collection(db, "sessions"), where("participant_id", "==", participantId));
        const querySnapshot = await getDocs(q);
        let maxSession = 0;
        querySnapshot.forEach((doc) => {
            const data = doc.data();
            const sNum = data.session_number;
            if (sNum && typeof sNum === 'string' && sNum.startsWith("ses-")) {
                const numStr = sNum.substring(4);
                const num = parseInt(numStr, 10);
                if (!isNaN(num) && num > maxSession) {
                    maxSession = num;
                }
            } else if (sNum) {
                const num = parseInt(sNum, 10);
                if (!isNaN(num) && num > maxSession) {
                    maxSession = num;
                }
            }
        });
        const nextSession = maxSession + 1;
        return String(nextSession).padStart(2, '0');
    } catch (error) {
        console.error("Error fetching next session number:", error);
        return "01";
    }
}

export async function getParticipantDetails(participantId) {
    if (!db || !participantId) return null;
    try {
        const q = query(collection(db, "participants"), where("participant_id", "==", participantId));
        const querySnapshot = await getDocs(q);
        let latestDoc = null;
        let latestTimestamp = 0;
        querySnapshot.forEach((doc) => {
            const data = doc.data();
            const ts = data.timestamp ? new Date(data.timestamp).getTime() : 0;
            if (ts > latestTimestamp) {
                latestTimestamp = ts;
                latestDoc = data;
            }
        });
        return latestDoc;
    } catch (error) {
        console.error("Error fetching participant details:", error);
        return null;
    }
}

export async function logOrUpdateParticipant(participantId, data) {
    if (!db) {
        console.warn("Firebase not initialized. Participant not logged.");
        return null;
    }
    try {
        const q = query(collection(db, "participants"), where("participant_id", "==", participantId));
        const querySnapshot = await getDocs(q);
        
        let docId = null;
        querySnapshot.forEach((doc) => {
            docId = doc.id;
        });
        
        const timestampedData = {
            ...data,
            timestamp: new Date().toISOString()
        };
        
        if (docId) {
            console.log(`[Firebase] Participant ${participantId} exists (doc ID: ${docId}). Updating...`);
            await updateDoc(doc(db, "participants", docId), timestampedData);
            return docId;
        } else {
            console.log(`[Firebase] Participant ${participantId} does not exist. Creating new...`);
            const docRef = await addDoc(collection(db, "participants"), timestampedData);
            return docRef.id;
        }
    } catch (e) {
        console.error("Error logging/updating participant: ", e);
        return null;
    }
}

export async function logOrUpdateSession(participantId, sessionNumber, data) {
    if (!db) {
        console.warn("Firebase not initialized. Session not logged.");
        return null;
    }
    try {
        const q = query(
            collection(db, "sessions"), 
            where("participant_id", "==", participantId), 
            where("session_number", "==", sessionNumber)
        );
        const querySnapshot = await getDocs(q);
        
        let docId = null;
        querySnapshot.forEach((doc) => {
            docId = doc.id;
        });
        
        const timestampedData = {
            ...data,
            participant_id: participantId,
            timestamp: new Date().toISOString()
        };
        
        if (docId) {
            console.log(`[Firebase] Session ${sessionNumber} for ${participantId} exists (doc ID: ${docId}). Updating...`);
            await updateDoc(doc(db, "sessions", docId), timestampedData);
            return docId;
        } else {
            console.log(`[Firebase] Session ${sessionNumber} for ${participantId} does not exist. Creating new...`);
            const docRef = await addDoc(collection(db, "sessions"), timestampedData);
            return docRef.id;
        }
    } catch (e) {
        console.error("Error logging/updating session: ", e);
        return null;
    }
}

export async function downloadAllFirestoreData() {
    if (!db) {
        console.warn("Firebase not initialized. Cannot download Firestore data.");
        return null;
    }
    try {
        const participantsSnapshot = await getDocs(collection(db, "participants"));
        const sessionsSnapshot = await getDocs(collection(db, "sessions"));
        const trialsSnapshot = await getDocs(collection(db, "trials"));
        const eventsSnapshot = await getDocs(collection(db, "experiment_events"));

        const participants = [];
        participantsSnapshot.forEach(doc => {
            participants.push({ id: doc.id, ...doc.data() });
        });

        const sessions = [];
        sessionsSnapshot.forEach(doc => {
            sessions.push({ id: doc.id, ...doc.data() });
        });

        const trials = [];
        trialsSnapshot.forEach(doc => {
            trials.push({ id: doc.id, ...doc.data() });
        });

        const events = [];
        eventsSnapshot.forEach(doc => {
            events.push({ id: doc.id, ...doc.data() });
        });

        return { participants, sessions, trials, events };
    } catch (e) {
        console.error("Error downloading all Firestore data:", e);
        throw e;
    }
}

