/**
 * Spatial Audio Utilities
 * 
 * Provides spatial audio rendering and head tracking support for browsers
 * that support Web Audio API and DeviceOrientation events (primarily Safari).
 * 
 * Features:
 * - Head tracking via device orientation (iOS Safari with AirPods)
 * - HRTF (Head-Related Transfer Function) rendering
 * - Binaural panning for spatial codecs
 */

// Types for spatial audio state
export interface SpatialAudioState {
    isSupported: boolean
    isEnabled: boolean
    headTrackingAvailable: boolean
    headTrackingEnabled: boolean
    orientation: { alpha: number; beta: number; gamma: number }
}

// Initial state export for consumers
export const DEFAULT_SPATIAL_STATE: SpatialAudioState = {
    isSupported: false,
    isEnabled: false,
    headTrackingAvailable: false,
    headTrackingEnabled: false,
    orientation: { alpha: 0, beta: 0, gamma: 0 }
}

// Check if browser supports spatial audio features
export function detectSpatialAudioSupport(): {
    webAudioSupported: boolean
    pannerSupported: boolean
    deviceOrientationSupported: boolean
    isIOS: boolean
    isSafari: boolean
} {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent)

    const webAudioSupported = typeof AudioContext !== 'undefined' ||
        typeof (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext !== 'undefined'

    const pannerSupported = webAudioSupported && typeof PannerNode !== 'undefined'

    const deviceOrientationSupported = typeof DeviceOrientationEvent !== 'undefined'

    return {
        webAudioSupported,
        pannerSupported,
        deviceOrientationSupported,
        isIOS,
        isSafari
    }
}

// Create a spatial audio context and panner for binaural rendering
export class SpatialAudioRenderer {
    private audioContext: AudioContext | null = null
    private pannerNode: PannerNode | null = null
    private sourceNode: MediaElementAudioSourceNode | null = null
    private gainNode: GainNode | null = null
    private isInitialized = false
    private isSpatialActive = false // Whether spatial processing is currently active
    private connectedAudioElement: HTMLAudioElement | null = null // Track which element is connected
    private orientationHandler: ((event: DeviceOrientationEvent) => void) | null = null
    private headTrackingEnabled = false

    // Listener position (virtual "ears" position)
    private listenerPosition = { x: 0, y: 0, z: 0 }

    // Audio source position (virtual speaker in 3D space)
    private sourcePosition = { x: 0, y: 1.5, z: -2 } // Default: in front, slightly above

    constructor() {
        // Check support on construction
        const support = detectSpatialAudioSupport()
        if (!support.webAudioSupported) {
            console.warn('[SpatialAudio] Web Audio API not supported')
        }
    }

    /**
     * Initialize spatial audio for an audio element
     */
    async initialize(audioElement: HTMLAudioElement): Promise<boolean> {
        // If already initialized with the SAME audio element, just enable spatial
        if (this.isInitialized && this.connectedAudioElement === audioElement) {
            this.enableSpatial()
            return true
        }

        // If initialized with a DIFFERENT audio element, we need to destroy first
        if (this.isInitialized && this.connectedAudioElement !== audioElement) {
            console.log('[SpatialAudio] Different audio element, destroying old context')
            this.destroy()
        }

        try {
            // Create AudioContext
            const AudioContextClass = window.AudioContext ||
                (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext

            if (!AudioContextClass) {
                console.error('[SpatialAudio] AudioContext not supported')
                return false
            }

            this.audioContext = new AudioContextClass()

            // Resume context if suspended (required for autoplay policies)
            if (this.audioContext.state === 'suspended') {
                await this.audioContext.resume()
            }

            // Create nodes
            this.sourceNode = this.audioContext.createMediaElementSource(audioElement)
            this.connectedAudioElement = audioElement
            this.gainNode = this.audioContext.createGain()

            // Create panner with HRTF for binaural rendering
            this.pannerNode = this.audioContext.createPanner()
            this.pannerNode.panningModel = 'HRTF' // Head-Related Transfer Function
            this.pannerNode.distanceModel = 'inverse'
            this.pannerNode.refDistance = 1
            this.pannerNode.maxDistance = 10000
            this.pannerNode.rolloffFactor = 1
            this.pannerNode.coneInnerAngle = 360
            this.pannerNode.coneOuterAngle = 360
            this.pannerNode.coneOuterGain = 0

            // Set initial position
            this.pannerNode.positionX.setValueAtTime(this.sourcePosition.x, this.audioContext.currentTime)
            this.pannerNode.positionY.setValueAtTime(this.sourcePosition.y, this.audioContext.currentTime)
            this.pannerNode.positionZ.setValueAtTime(this.sourcePosition.z, this.audioContext.currentTime)

            // Connect the audio graph WITH spatial processing
            this.sourceNode.connect(this.pannerNode)
            this.pannerNode.connect(this.gainNode)
            this.gainNode.connect(this.audioContext.destination)

            this.isInitialized = true
            this.isSpatialActive = true
            console.log('[SpatialAudio] Initialized successfully')
            return true

        } catch (error) {
            console.error('[SpatialAudio] Initialization failed:', error)
            return false
        }
    }

    /**
     * Enable head tracking using device orientation
     */
    async enableHeadTracking(): Promise<boolean> {
        if (!this.isInitialized || !this.audioContext) {
            console.warn('[SpatialAudio] Not initialized')
            return false
        }

        // Check if DeviceOrientationEvent requires permission (iOS 13+)
        if (typeof (DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> }).requestPermission === 'function') {
            try {
                const permission = await (DeviceOrientationEvent as unknown as { requestPermission: () => Promise<string> }).requestPermission()
                if (permission !== 'granted') {
                    console.warn('[SpatialAudio] Device orientation permission denied')
                    return false
                }
            } catch (e) {
                console.error('[SpatialAudio] Permission request failed:', e)
                return false
            }
        }

        // Set up orientation handler
        this.orientationHandler = (event: DeviceOrientationEvent) => {
            this.handleOrientationChange(event)
        }

        window.addEventListener('deviceorientation', this.orientationHandler, true)
        this.headTrackingEnabled = true
        console.log('[SpatialAudio] Head tracking enabled')
        return true
    }

    /**
     * Disable head tracking
     */
    disableHeadTracking(): void {
        if (this.orientationHandler) {
            window.removeEventListener('deviceorientation', this.orientationHandler, true)
            this.orientationHandler = null
        }
        this.headTrackingEnabled = false

        // Reset listener orientation
        if (this.audioContext) {
            const listener = this.audioContext.listener
            if (listener.forwardX) {
                listener.forwardX.setValueAtTime(0, this.audioContext.currentTime)
                listener.forwardY.setValueAtTime(0, this.audioContext.currentTime)
                listener.forwardZ.setValueAtTime(-1, this.audioContext.currentTime)
                listener.upX.setValueAtTime(0, this.audioContext.currentTime)
                listener.upY.setValueAtTime(1, this.audioContext.currentTime)
                listener.upZ.setValueAtTime(0, this.audioContext.currentTime)
            }
        }

        console.log('[SpatialAudio] Head tracking disabled')
    }

    /**
     * Handle device orientation changes for head tracking
     */
    private handleOrientationChange(event: DeviceOrientationEvent): void {
        if (!this.audioContext || !this.pannerNode) return

        const { alpha, beta, gamma } = event
        if (alpha === null || beta === null || gamma === null) return

        // Convert device orientation to listener orientation
        // alpha: rotation around Z axis (0-360)
        // beta: rotation around X axis (-180 to 180)
        // gamma: rotation around Y axis (-90 to 90)

        // Convert to radians
        const alphaRad = (alpha * Math.PI) / 180
        const betaRad = (beta * Math.PI) / 180
        const gammaRad = (gamma * Math.PI) / 180

        // Calculate forward vector based on device orientation
        // This simulates head turning
        const forwardX = Math.sin(alphaRad) * Math.cos(betaRad)
        const forwardY = -Math.sin(betaRad)
        const forwardZ = -Math.cos(alphaRad) * Math.cos(betaRad)

        // Calculate up vector
        const upX = Math.sin(gammaRad)
        const upY = Math.cos(gammaRad) * Math.cos(betaRad)
        const upZ = Math.cos(gammaRad) * Math.sin(betaRad)

        // Update listener orientation
        const listener = this.audioContext.listener
        const now = this.audioContext.currentTime

        if (listener.forwardX) {
            // Modern API
            listener.forwardX.setValueAtTime(forwardX, now)
            listener.forwardY.setValueAtTime(forwardY, now)
            listener.forwardZ.setValueAtTime(forwardZ, now)
            listener.upX.setValueAtTime(upX, now)
            listener.upY.setValueAtTime(upY, now)
            listener.upZ.setValueAtTime(upZ, now)
        } else if (listener.setOrientation) {
            // Legacy API
            listener.setOrientation(forwardX, forwardY, forwardZ, upX, upY, upZ)
        }
    }

    /**
     * Set the virtual source position (for non-head-tracking spatial effects)
     */
    setSourcePosition(x: number, y: number, z: number): void {
        this.sourcePosition = { x, y, z }
        if (this.pannerNode && this.audioContext) {
            this.pannerNode.positionX.setValueAtTime(x, this.audioContext.currentTime)
            this.pannerNode.positionY.setValueAtTime(y, this.audioContext.currentTime)
            this.pannerNode.positionZ.setValueAtTime(z, this.audioContext.currentTime)
        }
    }

    /**
     * Bypass spatial audio (direct connection) - keeps AudioContext alive
     */
    bypass(): void {
        if (!this.sourceNode || !this.gainNode || !this.audioContext) return
        if (!this.isSpatialActive) return // Already bypassed

        try {
            this.sourceNode.disconnect()
            this.sourceNode.connect(this.gainNode)
            this.isSpatialActive = false
            console.log('[SpatialAudio] Bypassed - direct connection')
        } catch (e) {
            console.error('[SpatialAudio] Bypass failed:', e)
        }
    }

    /**
     * Re-enable spatial processing
     */
    enableSpatial(): void {
        if (!this.sourceNode || !this.pannerNode || !this.gainNode || !this.audioContext) return
        if (this.isSpatialActive) return // Already active

        try {
            this.sourceNode.disconnect()
            this.sourceNode.connect(this.pannerNode)
            // Panner should already be connected to gain from init
            this.isSpatialActive = true
            console.log('[SpatialAudio] Spatial processing enabled')
        } catch (e) {
            console.error('[SpatialAudio] Enable spatial failed:', e)
        }
    }

    /**
     * Cleanup and disconnect - only call on unmount or audio element change
     */
    destroy(): void {
        this.disableHeadTracking()

        if (this.sourceNode) {
            try {
                this.sourceNode.disconnect()
            } catch { /* ignore */ }
            this.sourceNode = null
        }

        if (this.pannerNode) {
            try {
                this.pannerNode.disconnect()
            } catch { /* ignore */ }
            this.pannerNode = null
        }

        if (this.gainNode) {
            try {
                this.gainNode.disconnect()
            } catch { /* ignore */ }
            this.gainNode = null
        }

        if (this.audioContext) {
            try {
                this.audioContext.close()
            } catch { /* ignore */ }
            this.audioContext = null
        }

        this.connectedAudioElement = null
        this.isInitialized = false
        this.isSpatialActive = false

        console.log('[SpatialAudio] Destroyed')
    }

    /**
     * Get current state
     */
    getState(): SpatialAudioState {
        const support = detectSpatialAudioSupport()
        return {
            isSupported: support.webAudioSupported && support.pannerSupported,
            isEnabled: this.isInitialized,
            headTrackingAvailable: support.deviceOrientationSupported,
            headTrackingEnabled: this.headTrackingEnabled,
            orientation: { alpha: 0, beta: 0, gamma: 0 } // TODO: track last orientation
        }
    }
}

// Singleton instance
let spatialRenderer: SpatialAudioRenderer | null = null

export function getSpatialAudioRenderer(): SpatialAudioRenderer {
    if (!spatialRenderer) {
        spatialRenderer = new SpatialAudioRenderer()
    }
    return spatialRenderer
}

// Check if codec is a spatial codec
export function isSpatialCodec(codec: string | null): boolean {
    if (!codec) return false
    return ['atmos', 'aac-binaural', 'ac3', 'aac-he-binaural'].includes(codec)
}
