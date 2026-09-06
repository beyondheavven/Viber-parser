#!/usr/bin/env python3
import sys
import json
import time
import frida

def main():
    if len(sys.argv) < 4:
        print(json.dumps({"success": False, "error": "Usage: bridge.py <host> <port> <package>"}))
        sys.exit(1)

    host = sys.argv[1]
    port = sys.argv[2]
    package_name = sys.argv[3]
    source = sys.stdin.read()

    messages = []

    def on_message(message, data):
        messages.append(message)

    try:
        device = frida.get_device_manager().add_remote_device(f"{host}:{port}")

        try:
            session = device.attach(package_name)
        except frida.ProcessNotFoundError:
            pid = device.spawn([package_name])
            session = device.attach(pid)
            device.resume(pid)

        script = session.create_script(source)
        script.on("message", on_message)
        script.load()

        time.sleep(2)

        print(json.dumps({"success": True, "messages": messages}))

    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))
        sys.exit(1)

if __name__ == "__main__":
    main()