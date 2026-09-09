import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, query, where, doc, updateDoc, runTransaction, writeBatch } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";
import { getAuth, signInAnonymously, signInWithEmailAndPassword, onAuthStateChanged, signOut, deleteUser } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";

let app;
let db;
let auth;
let currentUser = null;
let enableFirestore = true;
let authCallbacks = [];

export function onAuthStateChange(callback) {
    authCallbacks.push(callback);
}

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
        auth = getAuth(app);

        let isFirstAuthCheck = true;
        // Listen for auth state changes
        onAuthStateChanged(auth, async (user) => {
            if (isFirstAuthCheck && user && user.isAnonymous) {
                try {
                    const q = query(collection(db, "participants"), where("uid", "==", user.uid));
                    const querySnapshot = await getDocs(q);
                    let hasIncomplete = false;
                    querySnapshot.forEach(doc => {
                        if (doc.data().status === "in_progress") hasIncomplete = true;
                    });
                    
                    if (!hasIncomplete) {
                        console.log("No incomplete session found. Deleting anonymous session on reload to save MAU quota...");
                        try {
                            await deleteUser(user);
                        } catch (e) {
                            console.error("Failed to delete orphaned anonymous user:", e);
                            await signOut(auth); // Fallback just in case
                        }
                        currentUser = null;
                        authCallbacks.forEach(cb => cb(null));
                    } else {
                        console.log("Incomplete session found! Keeping anonymous user to recycle ID.");
                        currentUser = user;
                        authCallbacks.forEach(cb => cb(user));
                    }
                } catch (err) {
                    console.error("Failed to check for incomplete session:", err);
                    currentUser = user; // Fallback to keeping the user if query fails
                    authCallbacks.forEach(cb => cb(user));
                }
                isFirstAuthCheck = false;
                return;
            }
            isFirstAuthCheck = false;
            currentUser = user;
            if (user) {
                console.log("User signed in:", user.isAnonymous ? "Anonymous" : user.email, "uid:", user.uid);
            } else {
                console.log("User signed out.");
            }
            authCallbacks.forEach(cb => cb(user));
        });

        return true;
    } catch (error) {
        console.error("Firebase initialization error:", error);
        return false;
    }
}

export function getCurrentUser() {
    return currentUser;
}

export function isAdmin() {
    return currentUser && !currentUser.isAnonymous;
}

export async function loginAsAdmin(email, password) {
    if (!auth) return false;
    try {
        await signInWithEmailAndPassword(auth, email, password);
        return true;
    } catch (error) {
        console.error("Admin login error:", error);
        return false;
    }
}

export async function loginAnonymously() {
    if (!auth) return false;
    try {
        await signInAnonymously(auth);
        return true;
    } catch (error) {
        console.error("Anonymous login error:", error);
        return false;
    }
}

export async function logoutUser() {
    if (!auth) return;
    try {
        await signOut(auth);
    } catch (error) {
        console.error("Logout error:", error);
    }
}

export function isFirestoreEnabled() {
    return !!(db && enableFirestore);
}

function removeUndefinedProperties(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(removeUndefinedProperties);
    const result = {};
    for (const key in obj) {
        if (obj[key] !== undefined) {
            result[key] = removeUndefinedProperties(obj[key]);
        }
    }
    return result;
}

export async function logDataToFirebase(collectionName, data) {
    if (!db) {
        console.warn("Firebase not initialized. Data not logged to cloud.");
        return false;
    }
    try {
        const cleanedData = removeUndefinedProperties(data);
        const docRef = await addDoc(collection(db, collectionName), {
            ...cleanedData,
            uid: currentUser ? currentUser.uid : null,
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
    // Only Admin can query the entire participants collection
    if (!isAdmin()) {
        console.warn("Anonymous users cannot query max participant ID. ID will be assigned at completion.");
        return "TBD";
    }
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
        let q;
        let querySnapshot;
        if (isAdmin()) {
            q = query(collection(db, "sessions"), where("participant_id", "==", participantId));
            querySnapshot = await getDocs(q);
        } else {
            q = query(collection(db, "sessions"), where("uid", "==", currentUser.uid));
            querySnapshot = await getDocs(q);
        }
        
        let maxSession = 0;
        querySnapshot.forEach((doc) => {
            const data = doc.data();
            if (!isAdmin() && data.participant_id !== participantId) return;
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
        let q;
        let querySnapshot;
        if (isAdmin()) {
            q = query(collection(db, "participants"), where("participant_id", "==", participantId));
            querySnapshot = await getDocs(q);
        } else {
            q = query(collection(db, "participants"), where("uid", "==", currentUser.uid));
            querySnapshot = await getDocs(q);
        }
        
        let latestDoc = null;
        let latestTimestamp = 0;
        querySnapshot.forEach((doc) => {
            const data = doc.data();
            if (!isAdmin() && data.participant_id !== participantId) return;
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
        const cleanedData = removeUndefinedProperties(data);
        let q;
        let querySnapshot;
        if (isAdmin()) {
            q = query(collection(db, "participants"), where("participant_id", "==", participantId));
            querySnapshot = await getDocs(q);
        } else {
            q = query(collection(db, "participants"), where("uid", "==", currentUser.uid));
            querySnapshot = await getDocs(q);
        }
        
        let docId = null;
        querySnapshot.forEach((doc) => {
            if (isAdmin() || doc.data().participant_id === participantId) {
                docId = doc.id;
            }
        });
        
        const timestampedData = {
            ...cleanedData,
            uid: currentUser ? currentUser.uid : null,
            timestamp: new Date().toISOString(),
            status: data.status || "in_progress"
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
        const cleanedData = removeUndefinedProperties(data);
        let q;
        let querySnapshot;
        if (isAdmin()) {
            q = query(collection(db, "sessions"), 
                where("participant_id", "==", participantId), 
                where("session_number", "==", sessionNumber));
            querySnapshot = await getDocs(q);
        } else {
            q = query(collection(db, "sessions"), where("uid", "==", currentUser.uid));
            querySnapshot = await getDocs(q);
        }
        
        let docId = null;
        querySnapshot.forEach((doc) => {
            const d = doc.data();
            if (isAdmin() || (d.participant_id === participantId && d.session_number === sessionNumber)) {
                docId = doc.id;
            }
        });
        
        const timestampedData = {
            ...cleanedData,
            uid: currentUser ? currentUser.uid : null,
            timestamp: new Date().toISOString()
        };
        
        if (docId) {
            console.log(`[Firebase] Session ${sessionNumber} for ${participantId} exists. Updating...`);
            await updateDoc(doc(db, "sessions", docId), timestampedData);
            return docId;
        } else {
            console.log(`[Firebase] Session ${sessionNumber} for ${participantId} does not exist. Creating new...`);
            // Ensure ID fields are properly set if not part of data
            if (!timestampedData.participant_id) timestampedData.participant_id = participantId;
            if (!timestampedData.session_number) timestampedData.session_number = sessionNumber;
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

export async function generateOfficialId(participantId) {
    if (!db || !currentUser) return participantId;
    
    // If admin, they already have an official ID
    if (isAdmin()) {
        console.log("Admin session, using current ID:", participantId);
        return participantId;
    }

    try {
        const counterRef = doc(db, "metadata", "counter");
        const officialIdNum = await runTransaction(db, async (transaction) => {
            const counterDoc = await transaction.get(counterRef);
            let newId = 1;
            if (!counterDoc.exists()) {
                console.log("Initializing counter document to 1");
                transaction.set(counterRef, { lastId: 1 });
            } else {
                newId = counterDoc.data().lastId + 1;
                transaction.update(counterRef, { lastId: newId });
            }
            return newId;
        });

        const formattedId = "sub-" + String(officialIdNum).padStart(3, '0');
        console.log("Generated official ID:", formattedId);
        return formattedId;
    } catch (e) {
        console.error("Transaction failed: ", e);
        return participantId;
    }
}

export async function markExperimentComplete(participantId) {
    if (!db || !currentUser) return;
    try {
        let q;
        let querySnapshot;
        if (isAdmin()) {
            q = query(collection(db, "participants"), where("participant_id", "==", participantId));
            querySnapshot = await getDocs(q);
            for (const docSnap of querySnapshot.docs) {
                await updateDoc(doc(db, "participants", docSnap.id), { status: "completed" });
            }
        } else {
            q = query(collection(db, "participants"), where("uid", "==", currentUser.uid));
            querySnapshot = await getDocs(q);
            for (const docSnap of querySnapshot.docs) {
                if (docSnap.data().participant_id === participantId) {
                    await updateDoc(doc(db, "participants", docSnap.id), { status: "completed" });
                }
            }
        }
    } catch (err) {
        console.error("Failed to mark experiment as complete:", err);
    }
}

export async function cleanupIncompleteSession() {
    if (!db || !currentUser || isAdmin()) return false;
    try {
        const q = query(collection(db, "participants"), where("uid", "==", currentUser.uid));
        const querySnapshot = await getDocs(q);
        
        let oldParticipantId = null;
        for (const docSnap of querySnapshot.docs) {
            if (docSnap.data().status === "in_progress") {
                if (!oldParticipantId) {
                    oldParticipantId = docSnap.data().participant_id;
                } else {
                    // We found multiple in_progress documents (orphaned from past bugs). Mark the extra ones as aborted.
                    console.log(`[Firebase] Marking orphaned session ${docSnap.data().participant_id} as aborted.`);
                    await updateDoc(doc(db, "participants", docSnap.id), { status: "aborted" });
                }
            }
        }

        if (oldParticipantId) {
            console.log("Cleaning up incomplete session for:", oldParticipantId);
            // Delete old trials and events
            const collectionsToClean = ["trials", "experiment_events", "sessions"];
            let batch = writeBatch(db);
            let updateCount = 0;
            
            for (const col of collectionsToClean) {
                const colQuery = query(collection(db, col), where("uid", "==", currentUser.uid));
                const colSnapshot = await getDocs(colQuery);
                for (const docSnap of colSnapshot.docs) {
                    batch.delete(doc(db, col, docSnap.id));
                    updateCount++;
                    if (updateCount >= 490) {
                        await batch.commit();
                        updateCount = 0;
                    }
                }
            }
            if (updateCount > 0) {
                await batch.commit();
            }
            return oldParticipantId; // Return the recycled ID
        }
        return false;
    } catch (err) {
        console.error("Failed to cleanup incomplete session:", err);
        return false;
    }
}
