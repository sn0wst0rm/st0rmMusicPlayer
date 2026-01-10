import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";

export const dynamic = "force-dynamic";

// Get the project root directory
const PROJECT_ROOT = path.resolve(process.cwd());
const SCRIPTS_PATH = path.join(PROJECT_ROOT, "scripts");
const DB_PATH = path.join(PROJECT_ROOT, "library.db");

// Start wrapper container in headless mode
export async function POST(_request: NextRequest) {
    try {
        // Call Python script to start wrapper
        const result = await new Promise<{ success: boolean; error?: string }>(
            (resolve) => {
                const proc = spawn("python3", [
                    "-c",
                    `
import sys
import sqlite3
from pathlib import Path
sys.path.insert(0, '${SCRIPTS_PATH}')
from wrapper_manager import get_wrapper_manager, init_wrapper_manager
import json

# Get library path from database and initialize wrapper manager
conn = sqlite3.connect('${DB_PATH}')
cursor = conn.cursor()
cursor.execute("SELECT mediaLibraryPath FROM GamdlSettings WHERE id = 'singleton'")
row = cursor.fetchone()
conn.close()
library_root = Path(row[0]) if row and row[0] else Path("./music")
init_wrapper_manager(library_root)

mgr = get_wrapper_manager()
docker_ok, image_ok, msg = mgr.get_availability()

if not docker_ok or not image_ok:
    print(json.dumps({"success": False, "error": msg}))
    sys.exit(0)

if mgr.is_running():
    print(json.dumps({"success": True, "already_running": True}))
    sys.exit(0)

success = mgr.start_headless()
print(json.dumps({"success": success, "error": "Failed to start container" if not success else None}))
`,
                ]);

                let output = "";
                proc.stdout.on("data", (data) => {
                    output += data.toString();
                });
                proc.stderr.on("data", (data) => {
                    console.error("[wrapper/start]", data.toString());
                });
                proc.on("close", () => {
                    try {
                        resolve(JSON.parse(output.trim()));
                    } catch {
                        resolve({ success: false, error: "Failed to parse response" });
                    }
                });
            }
        );

        if (result.success) {
            return NextResponse.json({ status: "started" });
        } else {
            return NextResponse.json({ error: result.error }, { status: 500 });
        }
    } catch (error) {
        console.error("Failed to start wrapper:", error);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}
