/**
 * Custom Next.js server with WebSocket proxy support.
 * 
 * This server:
 * 1. Handles HTTP requests via Next.js
 * 2. Accepts WebSocket connections from frontend clients on /ws
 * 3. Connects to Python backend WebSocket and proxies events bidirectionally
 */

import { createServer } from 'http';
import { parse } from 'url';
import next from 'next';
import { WebSocket, WebSocketServer } from 'ws';

const dev = process.env.NODE_ENV !== 'production';
const hostname = 'localhost';
const port = parseInt(process.env.PORT || '3000', 10);

const PYTHON_WS_URL = process.env.GAMDL_WS_URL || 'ws://127.0.0.1:5101';

// Track connected frontend clients
const frontendClients = new Set<WebSocket>();

// Single connection to Python backend
let pythonWs: WebSocket | null = null;
let pythonReconnectTimer: NodeJS.Timeout | null = null;
let pythonReconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_DELAY_BASE = 1000;

/**
 * Connect to Python WebSocket backend
 */
function connectToPython(): void {
    if (pythonWs?.readyState === WebSocket.OPEN) {
        return;
    }

    console.log(`[WS Proxy] Connecting to Python backend at ${PYTHON_WS_URL}...`);

    try {
        pythonWs = new WebSocket(PYTHON_WS_URL);

        pythonWs.on('open', () => {
            console.log('[WS Proxy] Connected to Python backend');
            pythonReconnectAttempts = 0;
            if (pythonReconnectTimer) {
                clearTimeout(pythonReconnectTimer);
                pythonReconnectTimer = null;
            }
        });

        pythonWs.on('message', (data) => {
            // Forward Python events to all connected frontend clients
            const message = data.toString();

            // Debug: log download_complete events to trace metadata
            try {
                const parsed = JSON.parse(message);
                if (parsed.type === 'download_complete') {
                    console.log('[WS Proxy] download_complete received:', JSON.stringify(parsed.data?.metadata || 'NO METADATA', null, 2));
                }
            } catch (e) {
                // Ignore parse errors for logging
            }

            for (const client of frontendClients) {
                if (client.readyState === WebSocket.OPEN) {
                    try {
                        client.send(message);
                    } catch (err) {
                        console.error('[WS Proxy] Error forwarding to client:', err);
                    }
                }
            }
        });

        pythonWs.on('close', () => {
            console.log('[WS Proxy] Disconnected from Python backend');
            pythonWs = null;
            scheduleReconnect();
        });

        pythonWs.on('error', (err) => {
            console.error('[WS Proxy] Python WebSocket error:', err.message);
            // Close will be called after error
        });

    } catch (err) {
        console.error('[WS Proxy] Failed to create Python WebSocket:', err);
        scheduleReconnect();
    }
}

/**
 * Schedule a reconnection attempt to Python backend
 */
function scheduleReconnect(): void {
    if (pythonReconnectTimer) return;

    if (pythonReconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        console.log('[WS Proxy] Max reconnect attempts reached, will retry on next frontend connection');
        return;
    }

    pythonReconnectAttempts++;
    const delay = RECONNECT_DELAY_BASE * Math.pow(2, pythonReconnectAttempts - 1);
    console.log(`[WS Proxy] Reconnecting in ${delay}ms (attempt ${pythonReconnectAttempts})`);

    pythonReconnectTimer = setTimeout(() => {
        pythonReconnectTimer = null;
        connectToPython();
    }, delay);
}

/**
 * Send a message to Python backend
 */
function sendToPython(message: string): boolean {
    if (pythonWs?.readyState === WebSocket.OPEN) {
        pythonWs.send(message);
        return true;
    }
    console.warn('[WS Proxy] Cannot send to Python - not connected');
    return false;
}

async function main() {
    const app = next({ dev, hostname, port });
    const handle = app.getRequestHandler();

    await app.prepare();

    const server = createServer(async (req, res) => {
        try {
            const parsedUrl = parse(req.url!, true);
            await handle(req, res, parsedUrl);
        } catch (err) {
            console.error('Error handling request:', err);
            res.statusCode = 500;
            res.end('Internal Server Error');
        }
    });

    // Create WebSocket server for frontend clients
    const wss = new WebSocketServer({ noServer: true });

    // Handle upgrade requests
    server.on('upgrade', (req, socket, head) => {
        const { pathname } = parse(req.url!, true);

        if (pathname === '/ws') {
            wss.handleUpgrade(req, socket, head, (ws) => {
                wss.emit('connection', ws, req);
            });
        } else {
            // Allow Next.js HMR WebSocket to work
            if (pathname?.startsWith('/_next/webpack-hmr')) {
                // Let Next.js handle HMR
                return;
            }
            socket.destroy();
        }
    });

    // Handle frontend WebSocket connections
    wss.on('connection', (ws) => {
        console.log(`[WS Proxy] Frontend client connected. Total: ${frontendClients.size + 1}`);
        frontendClients.add(ws);

        // Ensure we're connected to Python when clients connect
        if (!pythonWs || pythonWs.readyState !== WebSocket.OPEN) {
            pythonReconnectAttempts = 0; // Reset attempts on new client connection
            connectToPython();
        }

        // Forward messages from frontend to Python
        ws.on('message', (data) => {
            const message = data.toString();
            try {
                // Parse to validate it's JSON, then forward
                JSON.parse(message);
                sendToPython(message);
            } catch (err) {
                console.error('[WS Proxy] Invalid JSON from frontend:', err);
                ws.send(JSON.stringify({ type: 'error', error: 'Invalid JSON' }));
            }
        });

        ws.on('close', () => {
            frontendClients.delete(ws);
            console.log(`[WS Proxy] Frontend client disconnected. Total: ${frontendClients.size}`);
        });

        ws.on('error', (err) => {
            console.error('[WS Proxy] Frontend WebSocket error:', err);
            frontendClients.delete(ws);
        });
    });

    // Connect to Python backend on startup
    connectToPython();

    server.listen(port, () => {
        console.log(`> Ready on http://${hostname}:${port}`);
        console.log(`> WebSocket proxy listening on ws://${hostname}:${port}/ws`);
    });
}

main().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
});
