#!/usr/bin/env python3
"""
Serial Port Trigger Receiver
============================
This script listens on a specified COM/Serial port for trigger markers sent from
the Psychophysics Experiment Platform. It supports both character format (terminated by \n)
and raw hex/byte format.

Requirements:
    pip install pyserial

Usage:
    python read_serial_triggers.py <PORT> <BAUDRATE>

Examples:
    python read_serial_triggers.py COM3 115200
    python read_serial_triggers.py /dev/ttyUSB0 115200
"""

import sys
import serial
import serial.tools.list_ports

DEFAULT_BAUD = 115200

def list_available_ports():
    ports = serial.tools.list_ports.comports()
    if not ports:
        print("No serial ports found.")
        return
    print("\nAvailable Serial Ports:")
    for port, desc, hwid in sorted(ports):
        print(f"  - {port}: {desc} [{hwid}]")
    print()

def main():
    if len(sys.argv) < 2:
        print("Error: Port not specified.")
        list_available_ports()
        print("Usage: python read_serial_triggers.py <PORT> [BAUDRATE]")
        print(f"Default Baud Rate is {DEFAULT_BAUD}")
        sys.exit(1)

    port = sys.argv[1]
    baud = int(sys.argv[2]) if len(sys.argv) > 2 else DEFAULT_BAUD

    print(f"Connecting to {port} at {baud} baud...")
    try:
        ser = serial.Serial(port, baud, timeout=1)
        print(f"Successfully connected to {port}.")
        print("Listening for triggers... Press Ctrl+C to exit.\n")
    except Exception as e:
        print(f"Error opening port {port}: {e}")
        list_available_ports()
        sys.exit(1)

    buffer = bytearray()

    try:
        while True:
            # Read all available bytes
            if ser.in_waiting > 0:
                data = ser.read(ser.in_waiting)
                for byte in data:
                    buffer.append(byte)
                    
                    # Log raw hex byte received (good for raw hex format)
                    print(f"[Raw Byte] Received: {byte} (Hex: 0x{byte:02X})")
                    
                    # If we encounter a newline, print it as a character trigger string (for character format)
                    if byte == ord('\n'):
                        try:
                            # Strip the newline and decode to string
                            trigger_str = buffer[:-1].decode('utf-8').strip()
                            if trigger_str:
                                print(f"==> [Text Trigger] '{trigger_str}'")
                        except UnicodeDecodeError:
                            pass
                        buffer.clear()
    except KeyboardInterrupt:
        print("\nExiting listener...")
    finally:
        ser.close()
        print("Serial port closed.")

if __name__ == "__main__":
    main()
