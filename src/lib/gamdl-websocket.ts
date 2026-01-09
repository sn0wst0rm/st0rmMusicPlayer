/**
 * WebSocket client for communicating with the gamdl Python service.
 * Provides real-time bidirectional communication for downloads, sync, and validation.
 */

type MessageHandler = (data: unknown) => void;

interface PendingRequest {
    resolve: (value: unknown) => void;
    reject: (reason: unknown) => void;
    timeout: NodeJS.Timeout;
}

class GamdlWebSocketClient {
    private ws: WebSocket | null = null;
    private url: string;
    private reconnectAttempts = 0;
    private maxReconnectAttempts = 5;
    private reconnectDelay = 1000;
    private messageHandlers: Map<string, MessageHandler[]> = new Map();
    private pendingRequests: Map<string, PendingRequest> = new Map();
    private requestIdCounter = 0;
    private isConnecting = false;
    private shouldReconnect = true;

    constructor(url: string = 'ws://127.0.0.1:5101') {
        this.url = url;
    }

    /**
     * Connect to the WebSocket server.
     */
    async connect(): Promise<void> {
        if (this.ws?.readyState === WebSocket.OPEN) {
            return;
        }

        if (this.isConnecting) {
            // Wait for existing connection attempt
            return new Promise((resolve, reject) => {
                const checkConnection = setInterval(() => {
                    if (this.ws?.readyState === WebSocket.OPEN) {
                        clearInterval(checkConnection);
                        resolve();
                    } else if (!this.isConnecting) {
                        clearInterval(checkConnection);
                        reject(new Error('Connection failed'));
                    }
                }, 100);
            });
        }

        this.isConnecting = true;

        return new Promise((resolve, reject) => {
            try {
                this.ws = new WebSocket(this.url);

                this.ws.onopen = () => {
                    console.log('[WS] Connected to gamdl service');
                    this.isConnecting = false;
                    this.reconnectAttempts = 0;
                    resolve();
                };

                this.ws.onclose = () => {
                    console.log('[WS] Disconnected from gamdl service');
                    this.isConnecting = false;
                    this.handleDisconnect();
                };

                this.ws.onerror = (error) => {
                    console.error('[WS] WebSocket error:', error);
                    this.isConnecting = false;
                    reject(error);
                };

                this.ws.onmessage = (event) => {
                    this.handleMessage(event.data);
                };
            } catch (error) {
                this.isConnecting = false;
                reject(error);
            }
        });
    }

    /**
     * Disconnect from the WebSocket server.
     */
    disconnect(): void {
        this.shouldReconnect = false;
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }

    /**
     * Handle incoming WebSocket messages.
     */
    private handleMessage(data: string): void {
        try {
            const message = JSON.parse(data);
            const { type, requestId } = message;

            // Check if this is a response to a pending request
            if (requestId && this.pendingRequests.has(requestId)) {
                const pending = this.pendingRequests.get(requestId)!;
                clearTimeout(pending.timeout);
                this.pendingRequests.delete(requestId);

                if (type === 'error' || message.error) {
                    pending.reject(new Error(message.error || 'Unknown error'));
                } else {
                    pending.resolve(message);
                }
                return;
            }

            // Dispatch to registered handlers
            const handlers = this.messageHandlers.get(type) || [];
            handlers.forEach(handler => {
                try {
                    handler(message);
                } catch (error) {
                    console.error(`[WS] Handler error for ${type}:`, error);
                }
            });
        } catch (error) {
            console.error('[WS] Failed to parse message:', error);
        }
    }

    /**
     * Handle disconnection and reconnection.
     */
    private handleDisconnect(): void {
        if (!this.shouldReconnect) return;

        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
            console.log(`[WS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
            setTimeout(() => this.connect().catch(() => { }), delay);
        } else {
            console.error('[WS] Max reconnection attempts reached');
        }
    }

    /**
     * Register a handler for a specific message type.
     */
    on(type: string, handler: MessageHandler): () => void {
        if (!this.messageHandlers.has(type)) {
            this.messageHandlers.set(type, []);
        }
        this.messageHandlers.get(type)!.push(handler);

        // Return unsubscribe function
        return () => {
            const handlers = this.messageHandlers.get(type);
            if (handlers) {
                const index = handlers.indexOf(handler);
                if (index > -1) {
                    handlers.splice(index, 1);
                }
            }
        };
    }

    /**
     * Send a message and wait for a response.
     */
    async request<T = unknown>(type: string, data: Record<string, unknown> = {}, timeoutMs = 30000): Promise<T> {
        await this.connect();

        const requestId = `req_${++this.requestIdCounter}_${Date.now()}`;

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pendingRequests.delete(requestId);
                reject(new Error(`Request timeout: ${type}`));
            }, timeoutMs);

            this.pendingRequests.set(requestId, { resolve: resolve as (value: unknown) => void, reject, timeout });

            this.send({ type, requestId, ...data });
        });
    }

    /**
     * Send a message without waiting for a response.
     */
    send(data: Record<string, unknown>): void {
        if (this.ws?.readyState !== WebSocket.OPEN) {
            console.error('[WS] Cannot send - not connected');
            return;
        }
        this.ws.send(JSON.stringify(data));
    }

    /**
     * Check if connected.
     */
    get isConnected(): boolean {
        return this.ws?.readyState === WebSocket.OPEN;
    }

    // ============ High-level API methods ============

    /**
     * Validate a URL.
     */
    async validate(url: string, cookies?: string): Promise<unknown> {
        return this.request('validate', { url, cookies });
    }

    /**
     * Validate multiple URLs from text.
     */
    async validateBatch(text: string, cookies?: string): Promise<unknown> {
        return this.request('validate_batch', { text, cookies });
    }

    /**
     * Start a download. Use on('download_*') to receive progress events.
     */
    async startDownload(url: string, cookies: string, outputDir?: string): Promise<unknown> {
        return this.request('download', { url, cookies, output_dir: outputDir });
    }

    /**
     * Sync a playlist. Use on('sync_*') to receive progress events.
     */
    async syncPlaylist(playlistId: string, appleMusicId: string, globalId: string | null, cookies: string): Promise<unknown> {
        return this.request('sync_playlist', { playlistId, appleMusicId, globalId, cookies });
    }

    /**
     * Get playlist tracks from Apple Music.
     */
    async getPlaylistTracks(appleMusicId: string, globalId: string | null, cookies: string): Promise<unknown> {
        return this.request('get_playlist_tracks', { appleMusicId, globalId, cookies });
    }

    /**
     * Ping the server.
     */
    async ping(): Promise<boolean> {
        try {
            await this.request('ping', {}, 5000);
            return true;
        } catch {
            return false;
        }
    }
}

// Singleton instance
let gamdlClient: GamdlWebSocketClient | null = null;

export function getGamdlClient(): GamdlWebSocketClient {
    if (!gamdlClient) {
        const wsUrl = process.env.GAMDL_WS_URL || 'ws://127.0.0.1:5101';
        gamdlClient = new GamdlWebSocketClient(wsUrl);
    }
    return gamdlClient;
}

export { GamdlWebSocketClient };
export default getGamdlClient;
