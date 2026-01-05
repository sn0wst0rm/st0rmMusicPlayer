import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

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
    const { spawn } = require("child_process");

    return new Promise((resolve) => {
        const dataJson = JSON.stringify(data);
        const proc = spawn("python3", [
            "-c",
            `
import sys
sys.path.insert(0, '/home/sn0wst0rm/am-clone/scripts')
from wrapper_manager import get_wrapper_manager
import json

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
