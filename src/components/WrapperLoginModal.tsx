"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    InputOTP,
    InputOTPGroup,
    InputOTPSlot,
} from "@/components/ui/input-otp";
import { Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface WrapperLoginModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onAuthSuccess?: (data: {
        storefront: string;
        media_token: string;
        dev_token: string;
    }) => void;
}

type AuthState =
    | "idle"
    | "connecting"
    | "credentials"
    | "waiting"
    | "otp"
    | "success"
    | "error";

interface DialogMessage {
    title: string;
    message: string;
    buttons: string[];
}

export function WrapperLoginModal({
    open,
    onOpenChange,
    onAuthSuccess,
}: WrapperLoginModalProps) {
    const [authState, setAuthState] = useState<AuthState>("idle");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [otp, setOtp] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [dialogMessage, setDialogMessage] = useState<DialogMessage | null>(
        null
    );
    const [eventSource, setEventSource] = useState<EventSource | null>(null);
    const authCompletedRef = useRef(false);

    // Define handleAuthMessage first (used by startWrapperAuth)
    const handleAuthMessage = useCallback((data: {
        type: string;
        [key: string]: unknown;
    }) => {
        switch (data.type) {
            case "credentials_request":
                // Clear any previous errors when getting a new credentials request
                setError(null);
                setDialogMessage(null);
                if (data.need_2fa) {
                    setAuthState("otp");
                    setOtp(""); // Clear previous OTP
                } else {
                    setAuthState("credentials");
                    // Show retry message if this is a retry
                    if (data.message && (data.message as string).includes("failed")) {
                        setError(data.message as string);
                    }
                }
                break;

            case "dialog":
                setDialogMessage({
                    title: data.title as string,
                    message: data.message as string,
                    buttons: data.buttons as string[],
                });
                // For error dialogs, show error and allow retry
                const title = (data.title as string)?.toLowerCase() || "";
                if (
                    title.includes("password") ||
                    title.includes("incorrect") ||
                    title.includes("check") ||
                    title.includes("try again") ||
                    title.includes("error")
                ) {
                    // Don't change state here - wrapper will send new credentials_request
                    setError((data.title as string) || "Login failed");
                }
                break;

            case "auth_success":
                authCompletedRef.current = true;
                setAuthState("success");
                if (onAuthSuccess) {
                    onAuthSuccess({
                        storefront: data.storefront as string,
                        media_token: data.media_token as string,
                        dev_token: data.dev_token as string,
                    });
                }
                // Close after short delay
                setTimeout(() => onOpenChange(false), 1500);
                break;

            case "auth_failed":
                setError((data.reason as string) || "Authentication failed");
                setAuthState("error");
                break;
        }
    }, [onAuthSuccess, onOpenChange]);

    // Define startWrapperAuth after handleAuthMessage (since it depends on it)
    const startWrapperAuth = useCallback(async () => {
        try {
            // Use Next.js API proxy instead of direct Python call
            const es = new EventSource("/api/wrapper/auth/stream");
            setEventSource(es);

            es.onmessage = (event) => {
                const data = JSON.parse(event.data);
                handleAuthMessage(data);
            };

            es.onerror = () => {
                // Don't show error if auth already completed successfully
                if (!authCompletedRef.current) {
                    setError("Connection to wrapper lost");
                    setAuthState("error");
                }
                es.close();
            };
        } catch (e) {
            setError(`Failed to connect: ${e}`);
            setAuthState("error");
        }
    }, [handleAuthMessage]);

    // Reset state when modal opens
    useEffect(() => {
        if (open) {
            authCompletedRef.current = false;
            setAuthState("connecting");
            setError(null);
            setDialogMessage(null);
            setOtp("");

            // Start wrapper and connect to auth stream
            startWrapperAuth();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    // Cleanup eventSource when modal closes or component unmounts
    useEffect(() => {
        if (!open && eventSource) {
            eventSource.close();
            setEventSource(null);
        }
    }, [open, eventSource]);

    const handleSubmitCredentials = async () => {
        if (!email || !password) {
            setError("Please enter email and password");
            return;
        }
        setAuthState("waiting");
        setError(null);

        try {
            // Use Next.js API proxy instead of direct Python call
            const res = await fetch("/api/wrapper/auth/submit", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ type: "credentials", username: email, password }),
            });
            if (!res.ok) {
                const data = await res.json();
                setError(data.error || "Failed to submit credentials");
                setAuthState("credentials");
            }
        } catch (e) {
            setError(`Network error: ${e}`);
            setAuthState("credentials");
        }
    };

    const handleSubmitOtp = async () => {
        if (otp.length !== 6) {
            setError("Please enter 6-digit code");
            return;
        }
        setAuthState("waiting");
        setError(null);

        try {
            // Use Next.js API proxy instead of direct Python call
            const res = await fetch("/api/wrapper/auth/submit", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ type: "otp", code: otp }),
            });
            if (!res.ok) {
                const data = await res.json();
                setError(data.error || "Failed to submit OTP");
                setAuthState("otp");
            }
        } catch (e) {
            setError(`Network error: ${e}`);
            setAuthState("otp");
        }
    };

    const handleDialogAction = (action: string) => {
        setDialogMessage(null);
        if (action.toLowerCase() === "try again") {
            setAuthState("credentials");
            setPassword("");
        } else {
            // Cancel
            onOpenChange(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>
                        {authState === "success"
                            ? "Login Successful"
                            : "Apple Music Login"}
                    </DialogTitle>
                    <DialogDescription>
                        {authState === "credentials" &&
                            "Sign in with your Apple ID to enable lossless downloads."}
                        {authState === "otp" &&
                            "Enter the 6-digit verification code sent to your device."}
                        {authState === "connecting" && "Connecting to wrapper..."}
                        {authState === "waiting" && "Authenticating..."}
                        {authState === "success" && "You are now logged in."}
                    </DialogDescription>
                </DialogHeader>

                {/* Error alert */}
                {error && (
                    <Alert variant="destructive">
                        <AlertCircle className="h-4 w-4" />
                        <AlertTitle>Error</AlertTitle>
                        <AlertDescription>{error}</AlertDescription>
                    </Alert>
                )}

                {/* Dialog message from wrapper */}
                {dialogMessage && (
                    <Alert>
                        <AlertCircle className="h-4 w-4" />
                        <AlertTitle>{dialogMessage.title}</AlertTitle>
                        <AlertDescription>{dialogMessage.message}</AlertDescription>
                        <div className="mt-3 flex gap-2">
                            {dialogMessage.buttons.map((btn) => (
                                <Button
                                    key={btn}
                                    variant={btn.toLowerCase() === "cancel" ? "outline" : "default"}
                                    size="sm"
                                    onClick={() => handleDialogAction(btn)}
                                >
                                    {btn}
                                </Button>
                            ))}
                        </div>
                    </Alert>
                )}

                {/* Connecting state */}
                {authState === "connecting" && (
                    <div className="flex items-center justify-center py-8">
                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    </div>
                )}

                {/* Credentials form */}
                {authState === "credentials" && !dialogMessage && (
                    <div className="grid gap-4 py-4">
                        <div className="grid gap-2">
                            <Label htmlFor="email">Apple ID</Label>
                            <Input
                                id="email"
                                type="email"
                                placeholder="your@email.com"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                autoFocus
                            />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="password">Password</Label>
                            <Input
                                id="password"
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                onKeyDown={(e) => e.key === "Enter" && handleSubmitCredentials()}
                            />
                        </div>
                    </div>
                )}

                {/* OTP input */}
                {authState === "otp" && (
                    <div className="flex flex-col items-center gap-4 py-4">
                        <InputOTP
                            maxLength={6}
                            value={otp}
                            onChange={(value) => setOtp(value)}
                        >
                            <InputOTPGroup>
                                <InputOTPSlot index={0} />
                                <InputOTPSlot index={1} />
                                <InputOTPSlot index={2} />
                                <InputOTPSlot index={3} />
                                <InputOTPSlot index={4} />
                                <InputOTPSlot index={5} />
                            </InputOTPGroup>
                        </InputOTP>
                    </div>
                )}

                {/* Waiting state */}
                {authState === "waiting" && (
                    <div className="flex items-center justify-center py-8">
                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    </div>
                )}

                {/* Success state */}
                {authState === "success" && (
                    <div className="flex items-center justify-center py-8">
                        <CheckCircle2 className="h-12 w-12 text-green-500" />
                    </div>
                )}

                <DialogFooter>
                    {authState === "credentials" && !dialogMessage && (
                        <Button onClick={handleSubmitCredentials}>Sign In</Button>
                    )}
                    {authState === "otp" && (
                        <Button onClick={handleSubmitOtp} disabled={otp.length !== 6}>
                            Verify
                        </Button>
                    )}
                    {authState === "error" && (
                        <Button onClick={() => onOpenChange(false)} variant="outline">
                            Close
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
