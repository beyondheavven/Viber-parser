#!/usr/bin/env python3
import sys
import json
import time
import traceback

def main():
    result = {"success": False, "messages": [], "error": None}
    try:
        import frida

        if len(sys.argv) < 4:
            raise ValueError("usage: frida_bridge.py <host> <port> <package>")

        host = sys.argv[1]
        port = sys.argv[2]
        package_name = sys.argv[3]

        script_source = sys.stdin.read()
        messages = []

        def on_message(message, data):
            messages.append(message)

        device = frida.get_device_manager().add_remote_device(f"{host}:{port}")
        pid = device.spawn([package_name])
        session = device.attach(pid)

        script = session.create_script(script_source)
        script.on("message", on_message)
        script.load()

        device.resume(pid)
        time.sleep(3)

        result["success"] = True
        result["messages"] = messages
    except Exception as e:
        result["error"] = str(e)
        print(traceback.format_exc(), file=sys.stderr)

    print(json.dumps(result))

if __name__ == "__main__":
    main()