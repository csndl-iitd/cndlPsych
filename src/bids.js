export function normalizeSubjectId(id) {
    if (!id) return "sub-unknown";
    id = String(id).trim();
    if (id.startsWith("sub-")) {
        return id;
    }
    const num = parseInt(id, 10);
    if (!isNaN(num)) {
        return "sub-" + String(num).padStart(3, '0');
    }
    return "sub-" + id.replace(/[^a-zA-Z0-9]/g, "");
}

export function normalizeSessionNumber(session) {
    if (!session) return "ses-unknown";
    session = String(session).trim();
    if (session.startsWith("ses-")) {
        return session;
    }
    const num = parseInt(session, 10);
    if (!isNaN(num)) {
        return "ses-" + String(num).padStart(2, '0');
    }
    return "ses-" + session.replace(/[^a-zA-Z0-9]/g, "");
}

export function convertToTSV(dataArray, headers) {
    if (!dataArray || dataArray.length === 0) {
        return headers.join("\t") + "\n";
    }
    const lines = [headers.join("\t")];
    for (const item of dataArray) {
        const row = headers.map(header => {
            const val = item[header];
            if (val === undefined || val === null) return "";
            if (typeof val === "object") {
                return JSON.stringify(val).replace(/\t/g, " ").replace(/\r?\n/g, " ");
            }
            return String(val).replace(/\t/g, " ").replace(/\r?\n/g, " ");
        });
        lines.push(row.join("\t"));
    }
    return lines.join("\n") + "\n";
}

export async function writeDatasetDescription(dirHandle) {
    const desc = {
        "Name": "Psychphysics Experiment Platform Dataset",
        "BIDSVersion": "1.8.0",
        "DatasetType": "raw",
        "License": "CC0",
        "Authors": ["Psychphysics Experiment Platform"]
    };
    const fileHandle = await dirHandle.getFileHandle("dataset_description.json", { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(desc, null, 4));
    await writable.close();
}

export async function syncFirestoreToBids(dirHandle, dbData) {
    if (!dbData) return;

    // 1. Root description file
    await writeDatasetDescription(dirHandle);

    // 2. participants.tsv & participants.json
    const participants = dbData.participants || [];
    if (participants.length > 0) {
        const allKeys = new Set();
        participants.forEach(p => {
            Object.keys(p).forEach(k => allKeys.add(k));
        });
        allKeys.delete('id');
        allKeys.delete('timestamp');
        
        // Ensure participant_id is the first header
        const pHeaders = ['participant_id', ...Array.from(allKeys).filter(k => k !== 'participant_id')];
        
        // Normalize participant IDs in the data representation
        const normalizedParticipants = participants.map(p => {
            return {
                ...p,
                participant_id: normalizeSubjectId(p.participant_id)
            };
        });

        const participantsTSV = convertToTSV(normalizedParticipants, pHeaders);
        const pFileHandle = await dirHandle.getFileHandle("participants.tsv", { create: true });
        const pWritable = await pFileHandle.createWritable();
        await pWritable.write(participantsTSV);
        await pWritable.close();

        // Write participants.json description meta-info
        const descMeta = {};
        pHeaders.forEach(h => {
            descMeta[h] = { "Description": `Participant metadata field: ${h}` };
        });
        const pJsonHandle = await dirHandle.getFileHandle("participants.json", { create: true });
        const pJsonWritable = await pJsonHandle.createWritable();
        await pJsonWritable.write(JSON.stringify(descMeta, null, 4));
        await pJsonWritable.close();
    }

    // 3. For each participant, build folders & write behavioral / event logs
    for (const p of participants) {
        const rawPId = p.participant_id;
        if (!rawPId) continue;
        
        const normPId = normalizeSubjectId(rawPId);
        const subDirHandle = await dirHandle.getDirectoryHandle(normPId, { create: true });

        // Filter sessions matching this participant
        const sessions = (dbData.sessions || []).filter(s => {
            return s.participant_id === rawPId || s.participant_id === normPId;
        });

        for (const s of sessions) {
            const rawSNum = s.session_number;
            if (!rawSNum) continue;

            const normSNum = normalizeSessionNumber(rawSNum);
            const sesDirHandle = await subDirHandle.getDirectoryHandle(normSNum, { create: true });
            const eegDirHandle = await sesDirHandle.getDirectoryHandle("eeg", { create: true });

            // Gather trials for this participant and session
            const trials = (dbData.trials || []).filter(t => {
                const matchesP = t.participant_id === rawPId || t.participant_id === normPId;
                const matchesS = t.session_id === s.id || t.session_id === rawSNum || t.session_id === normSNum;
                return matchesP && matchesS;
            });

            if (trials.length > 0) {
                const trialKeys = new Set();
                trials.forEach(t => {
                    Object.keys(t).forEach(k => trialKeys.add(k));
                });
                trialKeys.delete('id');
                trialKeys.delete('session_id');
                trialKeys.delete('participant_id');
                const tHeaders = Array.from(trialKeys);

                const trialsTSV = convertToTSV(trials, tHeaders);
                const trialsHandle = await eegDirHandle.getFileHandle(`${normPId}_${normSNum}_task-experiment_beh.tsv`, { create: true });
                const trialsWritable = await trialsHandle.createWritable();
                await trialsWritable.write(trialsTSV);
                await trialsWritable.close();
            }

            // Gather events/triggers for this participant and session
            const events = (dbData.events || []).filter(e => {
                const matchesP = e.participantId === rawPId || e.participantId === normPId || e.participant_id === rawPId || e.participant_id === normPId;
                const matchesS = e.sessionNumber === rawSNum || e.sessionNumber === normSNum || e.sessionId === s.id || e.sessionDocId === s.id;
                return matchesP && matchesS;
            });

            if (events.length > 0) {
                const eventKeys = new Set();
                events.forEach(e => {
                    Object.keys(e).forEach(k => eventKeys.add(k));
                });
                eventKeys.delete('id');
                eventKeys.delete('sessionId');
                eventKeys.delete('participantId');
                eventKeys.delete('sessionNumber');
                eventKeys.delete('sessionDocId');
                eventKeys.delete('participant_id'); // standard clean up
                eventKeys.delete('session_id');
                const evHeaders = Array.from(eventKeys);

                const eventsTSV = convertToTSV(events, evHeaders);
                const eventsHandle = await eegDirHandle.getFileHandle(`${normPId}_${normSNum}_task-experiment_events.tsv`, { create: true });
                const eventsWritable = await eventsHandle.createWritable();
                await eventsWritable.write(eventsTSV);
                await eventsWritable.close();
            }
        }
    }
}

export async function saveSessionDataToBids(dirHandle, participantId, sessionNumber, trialsData, eventsData, webcamBlob, screenBlob) {
    const normPId = normalizeSubjectId(participantId);
    const normSNum = normalizeSessionNumber(sessionNumber);

    // 1. Create subject directory: sub-<pId>
    const subDirHandle = await dirHandle.getDirectoryHandle(normPId, { create: true });
    // 2. Create session directory: ses-<sNum>
    const sesDirHandle = await subDirHandle.getDirectoryHandle(normSNum, { create: true });
    // 3. Create eeg directory
    const eegDirHandle = await sesDirHandle.getDirectoryHandle("eeg", { create: true });

    // 4. Write trials (behavioral data) to sub-<pId>_ses-<sNum>_task-experiment_beh.tsv
    if (trialsData && trialsData.length > 0) {
        const trialKeys = new Set();
        trialsData.forEach(t => {
            Object.keys(t).forEach(k => trialKeys.add(k));
        });
        trialKeys.delete('id');
        trialKeys.delete('session_id');
        trialKeys.delete('participant_id');
        const headers = Array.from(trialKeys);
        const tsvContent = convertToTSV(trialsData, headers);
        const fileHandle = await eegDirHandle.getFileHandle(`${normPId}_${normSNum}_task-experiment_beh.tsv`, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(tsvContent);
        await writable.close();
    }

    // 5. Write events to sub-<pId>_ses-<sNum>_task-experiment_events.tsv
    if (eventsData && eventsData.length > 0) {
        const eventKeys = new Set();
        eventsData.forEach(e => {
            Object.keys(e).forEach(k => eventKeys.add(k));
        });
        eventKeys.delete('id');
        eventKeys.delete('sessionId');
        eventKeys.delete('participantId');
        eventKeys.delete('sessionNumber');
        eventKeys.delete('sessionDocId');
        eventKeys.delete('participant_id');
        eventKeys.delete('session_id');
        const headers = Array.from(eventKeys);
        const tsvContent = convertToTSV(eventsData, headers);
        const fileHandle = await eegDirHandle.getFileHandle(`${normPId}_${normSNum}_task-experiment_events.tsv`, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(tsvContent);
        await writable.close();
    }

    // 6. Write webcam video
    if (webcamBlob) {
        const fileHandle = await eegDirHandle.getFileHandle(`${normPId}_${normSNum}_task-experiment_webcam.webm`, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(webcamBlob);
        await writable.close();
    }

    // 7. Write screen video
    if (screenBlob) {
        const fileHandle = await eegDirHandle.getFileHandle(`${normPId}_${normSNum}_task-experiment_screen.webm`, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(screenBlob);
        await writable.close();
    }

    // 8. Make sure root metadata exists (dataset_description.json)
    try {
        await writeDatasetDescription(dirHandle);
    } catch (e) {
        console.error("Failed to write/check dataset_description.json in root:", e);
    }
}
