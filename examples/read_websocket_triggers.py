#!/usr/bin/env python3
"""
WebSocket Trigger Receiver Server
================================
This script starts a WebSocket server that listens for incoming connections and
displays experiment trigger messages sent by the Psychophysics Experiment Platform.

Requirements:
    pip install websockets

Usage:
    python read_websocket_triggers.py [HOST] [PORT]

Examples:
    python read_websocket_triggers.py localhost 8080
    python read_websocket_triggers.py 0.0.0.0 8080
"""

import sys
import json
import asyncio
import websockets

DEFAULT_HOST = "localhost"
DEFAULT_PORT = 8080

async def handler(websocket, path):
    client_address = websocket.remote_address
    print(f"Client connected: {client_address}")
    try:
        async for message in websocket:
            try:
                # Parse JSON payload sent from the browser client
                data = json.loads(message)
                
                trigger = data.get("trigger")
                hex_val = data.get("hex")
                time_offset = data.get("time") # Milliseconds since performance.now() epoch
                
                # Format printing
                if hex_val:
                    print(f"==> [Hex Trigger] Value: {trigger} (Hex: {hex_val}) | Time offset: {time_offset:.2f}ms")
                else:
                    # Strip any trailing newline characters for display
                    clean_trigger = str(trigger).replace('\n', '\\n')
                    print(f"==> [Text Trigger] Value: '{clean_trigger}' | Time offset: {time_offset:.2f}ms")
            except json.JSONDecodeError:
                # Fallback if raw text is sent
                print(f"Received (Raw Text): {message}")
            except Exception as e:
                print(f"Error parsing message: {e}")
    except websockets.exceptions.ConnectionClosed as e:
        print(f"Client disconnected: {client_address} (code: {e.code})")

async def main():
    host = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_HOST
    port = int(sys.argv[2]) if len(sys.argv) > 2 else DEFAULT_PORT

    print(f"Starting WebSocket server on ws://{host}:{port} ...")
    
    async with websockets.serve(handler, host, port):
        print("Server is running. Open the experiment web page and connect to this WebSocket address.")
        print("Listening for triggers... Press Ctrl+C to exit.\n")
        await asyncio.Future()  # run forever

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nWebSocket server stopped.")
