let triggerMode = 'none'; // 'none', 'webserial', 'webusb', 'websocket'
let triggerFormat = 'character'; // 'character', 'hex'
let port = null; // Serial port or USB device
let ws = null; // WebSocket

export function setTriggerMode(mode, config = {}) {
    triggerMode = mode;
    if (config.format) {
        triggerFormat = config.format;
    }
    if (mode === 'websocket' && config.url) {
        connectWebSocket(config.url);
    }
}

export async function connectDevice() {
    try {
        if (triggerMode === 'webserial') {
            port = await navigator.serial.requestPort();
            await port.open({ baudRate: 115200 }); // Updated to 115200 baud rate
            return true;
        } else if (triggerMode === 'webusb') {
            port = await navigator.usb.requestDevice({ filters: [] }); // Open filter for testing
            await port.open();
            if (port.configuration === null) await port.selectConfiguration(1);
            await port.claimInterface(0);
            return true;
        }
        return false;
    } catch (err) {
        console.error(`Error connecting to ${triggerMode}:`, err);
        return false;
    }
}

export async function autoConnectDevice() {
    try {
        if (triggerMode === 'webserial') {
            if (navigator.serial && typeof navigator.serial.getPorts === 'function') {
                const ports = await navigator.serial.getPorts();
                if (ports.length > 0) {
                    port = ports[0];
                    await port.open({ baudRate: 115200 }); // Updated to 115200 baud rate
                    return true;
                }
            }
        } else if (triggerMode === 'webusb') {
            if (navigator.usb && typeof navigator.usb.getDevices === 'function') {
                const devices = await navigator.usb.getDevices();
                if (devices.length > 0) {
                    port = devices[0];
                    await port.open();
                    if (port.configuration === null) await port.selectConfiguration(1);
                    await port.claimInterface(0);
                    return true;
                }
            }
        } else if (triggerMode === 'websocket') {
            // Already handled by setTriggerMode -> connectWebSocket
            return ws && ws.readyState === WebSocket.OPEN;
        }
        return false;
    } catch (err) {
        console.error(`Error auto-connecting to ${triggerMode}:`, err);
        return false;
    }
}

export function isTriggerConnected() {
    if (triggerMode === 'none') return true;
    if (triggerMode === 'webserial') return !!(port && port.writable);
    if (triggerMode === 'webusb') return !!(port && port.opened);
    if (triggerMode === 'websocket') return !!(ws && ws.readyState === WebSocket.OPEN);
    return false;
}

export function getTriggerMode() {
    return triggerMode;
}

function connectWebSocket(url) {
    if (ws) {
        try { ws.close(); } catch (e) {}
    }
    ws = new WebSocket(url);
    ws.onopen = () => console.log('WebSocket Trigger connected');
    ws.onerror = (err) => console.error('WebSocket error:', err);
}

export async function sendTrigger(value) {
    if (triggerMode === 'none') return;
    const startTime = performance.now();
    
    // Parse value as integer (handling hex string notation "0x...")
    let triggerInt = parseInt(value, 10);
    if (String(value).toLowerCase().startsWith("0x")) {
        triggerInt = parseInt(value, 16);
    }
    
    let data;
    if (triggerMode === 'webserial' || triggerMode === 'webusb') {
        if (triggerFormat === 'hex') {
            if (isNaN(triggerInt)) {
                console.warn(`Invalid integer/hex value for trigger: ${value}`);
                triggerInt = 0;
            }
            data = new Uint8Array([triggerInt]);
        } else {
            data = new TextEncoder().encode(String(value) + "\n");
        }
    }

    try {
        if (triggerMode === 'webserial') {
            if (!port || !port.writable) throw new Error("Serial port not connected or not writable");
            const localWriter = port.writable.getWriter();
            try {
                await localWriter.write(data);
            } finally {
                localWriter.releaseLock();
            }
        } else if (triggerMode === 'webusb') {
            if (!port) throw new Error("USB device not connected");
            await port.transferOut(1, data); 
        } else if (triggerMode === 'websocket') {
            if (!ws || ws.readyState !== WebSocket.OPEN) throw new Error("WebSocket not connected");
            if (triggerFormat === 'hex') {
                ws.send(JSON.stringify({ 
                    trigger: triggerInt, 
                    hex: "0x" + (isNaN(triggerInt) ? "00" : triggerInt.toString(16).toUpperCase()), 
                    time: startTime 
                }));
            } else {
                ws.send(JSON.stringify({ trigger: String(value) + "\n", time: startTime }));
            }
        }
    } catch (err) {
        console.error("Failed to send trigger:", err);
        throw err;
    }
}
