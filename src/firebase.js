import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { getFirestore, collection, addDoc } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";

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
