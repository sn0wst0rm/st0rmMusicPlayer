import { NextRequest } from "next/server";
import { spawn } from "child_process";
import path from "path";

export const dynamic = "force-dynamic";

// Get the project root directory
const PROJECT_ROOT = path.resolve(process.cwd());
const SCRIPTS_PATH = path.join(PROJECT_ROOT, "scripts");
const DB_PATH = path.join(PROJECT_ROOT, "library.db");

// Server-Sent Events stream for wrapper auth messages
export async function GET(request: NextRequest) {
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
        async start(controller) {
            // Connect to wrapper auth socket and relay messages
            const proc = spawn("python3", [
                "-c",
                `
import sys
import sqlite3
from pathlib import Path
sys.path.insert(0, '${SCRIPTS_PATH}')
from wrapper_manager import get_wrapper_manager, init_wrapper_manager
import json
import time

# Get library path from database and initialize wrapper manager
conn = sqlite3.connect('${DB_PATH}')
cursor = conn.cursor()
cursor.execute("SELECT mediaLibraryPath FROM GamdlSettings WHERE id = 'singleton'")
row = cursor.fetchone()
conn.close()
library_root = Path(row[0]) if row and row[0] else Path("./music")
init_wrapper_manager(library_root)

mgr = get_wrapper_manager()

# Try to connect to auth socket
max_retries = 20
for i in range(max_retries):
    if mgr.connect_auth_socket(timeout=2.0):
        print("CONNECTED", flush=True)
        break
    time.sleep(0.5)
else:
    print(json.dumps({"type": "error", "message": "Failed to connect to auth socket"}), flush=True)
    sys.exit(1)

# Read messages and print them
while True:
    msg = mgr._recv_auth_message(timeout=120.0)
    if msg:
        print(json.dumps(msg), flush=True)
        if msg.get("type") in ["auth_success", "auth_failed"]:
            break
    time.sleep(0.1)
`,
            ]);

            proc.stdout.on("data", (data: Buffer) => {
                const lines = data.toString().trim().split("\n");
                for (const line of lines) {
                    if (line === "CONNECTED") {
                        continue; // Skip connection marker
                    }
                    try {
                        // Validate JSON and send as SSE event
                        JSON.parse(line);
                        const sseData = `data: ${line}\n\n`;
                        controller.enqueue(encoder.encode(sseData));
                    } catch {
                        console.error("[auth/stream] Invalid JSON:", line);
                    }
                }
            });

            proc.stderr.on("data", (data: Buffer) => {
                console.error("[auth/stream stderr]", data.toString());
            });

            proc.on("close", () => {
                controller.close();
            });

            // Handle client disconnect
            request.signal.addEventListener("abort", () => {
                proc.kill();
            });
        },
    });

    return new Response(stream, {
        headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
        },
    });
}
