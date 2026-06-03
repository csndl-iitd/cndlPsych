import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, query, where } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";

let app;
let db;

export function initFirebase(config) {
    try {
        app = initializeApp(config);
        db = getFirestore(app);
        return true;
    } catch (error) {
        console.error("Firebase initialization error:", error);
        return false;
    }
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
