import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";

export const dynamic = "force-dynamic";

// Get the project root directory
const PROJECT_ROOT = path.resolve(process.cwd());
const SCRIPTS_PATH = path.join(PROJECT_ROOT, "scripts");
const DB_PATH = path.join(PROJECT_ROOT, "library.db");

// Submit credentials or OTP to wrapper auth socket
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { type } = body;

        if (type === "credentials") {
            const { username, password } = body;
            if (!username || !password) {
                return NextResponse.json(
                    { error: "Missing username or password" },
                    { status: 400 }
                );
            }

            // Send to wrapper via Python
            const result = await sendToWrapper({ type, username, password });
            if (result.success) {
                return NextResponse.json({ status: "submitted" });
            } else {
                return NextResponse.json({ error: result.error }, { status: 500 });
            }
        } else if (type === "otp") {
            const { code } = body;
            if (!code || code.length !== 6) {
                return NextResponse.json(
                    { error: "Invalid OTP code" },
                    { status: 400 }
                );
            }

            const result = await sendToWrapper({ type, code });
            if (result.success) {
                return NextResponse.json({ status: "submitted" });
            } else {
                return NextResponse.json({ error: result.error }, { status: 500 });
            }
        } else {
            return NextResponse.json({ error: "Unknown type" }, { status: 400 });
        }
    } catch (error) {
        console.error("Failed to submit auth:", error);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}

async function sendToWrapper(
    data: Record<string, unknown>
): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolve) => {
        const dataJson = JSON.stringify(data);
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
data = json.loads('''${dataJson}''')

if data["type"] == "credentials":
    success = mgr.submit_credentials(data["username"], data["password"])
elif data["type"] == "otp":
    success = mgr.submit_otp(data["code"])
else:
    success = False

print(json.dumps({"success": success}))
`,
        ]);

        let output = "";
        proc.stdout.on("data", (d: Buffer) => {
            output += d.toString();
        });
        proc.stderr.on("data", (d: Buffer) => {
            console.error("[wrapper/auth/submit]", d.toString());
        });
        proc.on("close", () => {
            try {
                resolve(JSON.parse(output.trim()));
            } catch {
                resolve({ success: false, error: "Failed to parse response" });
            }
        });
    });
}
