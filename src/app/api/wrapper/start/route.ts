import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";

export const dynamic = "force-dynamic";

// Start wrapper container in headless mode
export async function POST(request: NextRequest) {
    try {
        // Call Python script to start wrapper
        const result = await new Promise<{ success: boolean; error?: string }>(
            (resolve) => {
                const proc = spawn("python3", [
                    "-c",
                    `
import sys
sys.path.insert(0, '/home/sn0wst0rm/am-clone/scripts')
from wrapper_manager import get_wrapper_manager
import json

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
