let triggerMode = 'none'; // 'none', 'webserial', 'webusb', 'websocket'
let port = null; // Serial port or USB device
let ws = null; // WebSocket
let writer = null; // Serial/USB writer

export function setTriggerMode(mode, config = {}) {
    triggerMode = mode;
    if (mode === 'websocket' && config.url) {
        connectWebSocket(config.url);
    }
}

export async function connectDevice() {
    try {
        if (triggerMode === 'webserial') {
            port = await navigator.serial.requestPort();
            await port.open({ baudRate: 9600 }); // Common baud rate for TTL
            writer = port.writable.getWriter();
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

function connectWebSocket(url) {
    ws = new WebSocket(url);
    ws.onopen = () => console.log('WebSocket Trigger connected');
    ws.onerror = (err) => console.error('WebSocket error:', err);
}

export async function sendTrigger(value) {
    if (triggerMode === 'none') return;
    const startTime = performance.now();
    try {
        if (triggerMode === 'webserial' && writer) {
            const data = new Uint8Array([value]);
            await writer.write(data);
        } else if (triggerMode === 'webusb' && port) {
            // WebUSB requires knowing the specific endpoint
            const data = new Uint8Array([value]);
            await port.transferOut(1, data); 
        } else if (triggerMode === 'websocket' && ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ trigger: value, time: startTime }));
        }
    } catch (err) {
        console.error("Failed to send trigger:", err);
    }
}
