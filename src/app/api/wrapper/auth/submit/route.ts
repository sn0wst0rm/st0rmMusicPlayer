import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const GAMDL_SERVICE_URL = "http://127.0.0.1:5100";

// Proxy to gamdl service which maintains the wrapper auth socket connection
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();

        const res = await fetch(`${GAMDL_SERVICE_URL}/wrapper/auth/submit`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });

        const data = await res.json();

        if (!res.ok) {
            return NextResponse.json(
                { error: data.detail || data.error || "Failed to submit" },
                { status: res.status }
            );
        }

        return NextResponse.json(data);
    } catch (error) {
        console.error("[wrapper/auth/submit] Error:", error);
        return NextResponse.json(
            { error: "Failed to connect to gamdl service" },
            { status: 500 }
        );
    }
}
