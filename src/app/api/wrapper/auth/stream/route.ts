import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const GAMDL_SERVICE_URL = "http://127.0.0.1:5100";

// Proxy SSE stream from gamdl service
export async function GET(request: NextRequest) {
    const encoder = new TextEncoder();
    let controllerClosed = false;
    let abortController: AbortController | null = null;

    const stream = new ReadableStream({
        async start(controller) {
            const closeController = () => {
                if (!controllerClosed) {
                    controllerClosed = true;
                    try {
                        controller.close();
                    } catch {
                        // Already closed
                    }
                }
            };

            try {
                abortController = new AbortController();

                const res = await fetch(`${GAMDL_SERVICE_URL}/wrapper/auth/stream`, {
                    signal: abortController.signal,
                });

                if (!res.ok || !res.body) {
                    const errorData = `data: ${JSON.stringify({ type: "error", message: "Failed to connect to gamdl service" })}\n\n`;
                    controller.enqueue(encoder.encode(errorData));
                    closeController();
                    return;
                }

                const reader = res.body.getReader();
                const decoder = new TextDecoder();

                // Read from gamdl service and forward to client
                while (true) {
                    const { done, value } = await reader.read();
                    if (done || controllerClosed) {
                        break;
                    }

                    const chunk = decoder.decode(value, { stream: true });
                    controller.enqueue(encoder.encode(chunk));
                }

                closeController();
            } catch (error) {
                if (!controllerClosed) {
                    console.error("[auth/stream] Error:", error);
                    const errorData = `data: ${JSON.stringify({ type: "error", message: "Connection error" })}\n\n`;
                    try {
                        controller.enqueue(encoder.encode(errorData));
                    } catch {
                        // Controller might be closed
                    }
                    closeController();
                }
            }
        },
        cancel() {
            controllerClosed = true;
            if (abortController) {
                abortController.abort();
            }
        },
    });

    // Handle client disconnect
    request.signal.addEventListener("abort", () => {
        controllerClosed = true;
        if (abortController) {
            abortController.abort();
        }
    });

    return new Response(stream, {
        headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
        },
    });
}
