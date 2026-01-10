import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";

export const dynamic = "force-dynamic";

// Get the project root directory
const PROJECT_ROOT = path.resolve(process.cwd());
const DB_PATH = path.join(PROJECT_ROOT, "library.db");

// Get wrapper status
export async function GET(_request: NextRequest) {
    return new Promise<NextResponse>((resolve) => {
        const proc = spawn("python3", [
            "-c",
            `
import sys
import sqlite3
from pathlib import Path
sys.path.insert(0, '${PROJECT_ROOT}/scripts')
from wrapper_manager import init_wrapper_manager, get_wrapper_manager
import json

# Get library path from database
try:
    conn = sqlite3.connect('${DB_PATH}')
    cursor = conn.cursor()
    cursor.execute("SELECT mediaLibraryPath FROM GamdlSettings WHERE id = 'singleton'")
    row = cursor.fetchone()
    conn.close()

    if not row or not row[0]:
        print(json.dumps({"error": "Settings not configured", "docker_available": False, "image_available": False, "message": "Please configure settings first"}))
        sys.exit(0)

    library_root = Path(row[0])

    # Initialize wrapper manager with library path
    init_wrapper_manager(library_root)
    mgr = get_wrapper_manager()
    docker_ok, image_ok, msg = mgr.get_availability()

    result = {
        "docker_available": docker_ok,
        "image_available": image_ok,
        "has_saved_session": mgr.has_saved_session() if docker_ok and image_ok else False,
        "is_running": mgr.is_running() if docker_ok and image_ok else False,
        "needs_auth": docker_ok and image_ok and not mgr.has_saved_session(),
        "message": msg
    }
    print(json.dumps(result))
except Exception as e:
    print(json.dumps({"error": str(e), "docker_available": False, "image_available": False, "message": str(e)}))
`,
        ]);

        let output = "";
        proc.stdout.on("data", (data) => {
            output += data.toString();
        });
        proc.stderr.on("data", (data) => {
            console.error("[wrapper/status]", data.toString());
        });
        proc.on("close", () => {
            try {
                const result = JSON.parse(output.trim());
                resolve(NextResponse.json(result));
            } catch {
                resolve(
                    NextResponse.json(
                        { error: "Failed to get wrapper status" },
                        { status: 500 }
                    )
                );
            }
        });
    });
}
