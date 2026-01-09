import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";

export const dynamic = "force-dynamic";

// Get wrapper status
export async function GET(_request: NextRequest) {
    return new Promise<NextResponse>((resolve) => {
        const proc = spawn("python3", [
            "-c",
            `
import sys
sys.path.insert(0, '/home/sn0wst0rm/am-clone/scripts')
from wrapper_manager import get_wrapper_manager
import json

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
