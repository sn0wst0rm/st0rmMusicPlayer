"""
Wrapper Manager - Controls the lifecycle of the C wrapper via Docker.

This module manages the wrapper Docker container in headless mode,
communicating with the wrapper's auth socket (port 40020) for login
and relaying messages to the web app.
"""

import asyncio
import json
import logging
import shutil
import socket
import struct
import subprocess
from pathlib import Path
from typing import Callable, Optional, Tuple

logger = logging.getLogger(__name__)

# Default ports
WRAPPER_DECRYPT_PORT = 10020
WRAPPER_M3U8_PORT = 20020
WRAPPER_ACCOUNT_PORT = 30020
WRAPPER_AUTH_PORT = 40020

# Docker image name
DOCKER_IMAGE = "wrapper"

# Container name for managing lifecycle
CONTAINER_NAME = "am-wrapper"

# Media library root (hidden folder for wrapper data)
LIBRARY_ROOT = Path("/media/sn0wst0rm/megaDrive/musica")
WRAPPER_DATA_DIR = LIBRARY_ROOT / ".am-wrapper"


class DockerWrapperManager:
    """Manages the wrapper Docker container lifecycle with headless authentication."""
    
    def __init__(
        self,
        host: str = "127.0.0.1",
        decrypt_port: int = WRAPPER_DECRYPT_PORT,
        m3u8_port: int = WRAPPER_M3U8_PORT,
        account_port: int = WRAPPER_ACCOUNT_PORT,
        auth_port: int = WRAPPER_AUTH_PORT,
        data_dir: Optional[Path] = None,
    ):
        self.host = host
        self.decrypt_port = decrypt_port
        self.m3u8_port = m3u8_port
        self.account_port = account_port
        self.auth_port = auth_port
        self.data_dir = data_dir or WRAPPER_DATA_DIR
        self._container_id: Optional[str] = None
        self._started = False
        self._auth_socket: Optional[socket.socket] = None
        self._auth_connected = False
        # Callbacks for auth events
        self._on_credentials_request: Optional[Callable] = None
        self._on_dialog: Optional[Callable] = None
        self._on_auth_success: Optional[Callable] = None
        self._on_auth_failed: Optional[Callable] = None
    
    @staticmethod
    def check_docker_available() -> bool:
        """Check if Docker is installed and running."""
        docker_path = shutil.which("docker")
        if not docker_path:
            return False
        try:
            result = subprocess.run(["docker", "info"], capture_output=True, timeout=10)
            return result.returncode == 0
        except Exception:
            return False
    
    @staticmethod
    def check_image_available() -> bool:
        """Check if the wrapper Docker image exists."""
        try:
            result = subprocess.run(
                ["docker", "images", "-q", DOCKER_IMAGE],
                capture_output=True,
                text=True,
                timeout=10,
            )
            return result.returncode == 0 and result.stdout.strip() != ""
        except Exception:
            return False
    
    def get_availability(self) -> Tuple[bool, bool, str]:
        """Check Docker and image availability."""
        docker_ok = self.check_docker_available()
        if not docker_ok:
            return False, False, "Docker not available"
        image_ok = self.check_image_available()
        if not image_ok:
            return True, False, "Wrapper image not found"
        return True, True, "Ready"
    
    def _ensure_data_dir(self) -> bool:
        """Create data directory if needed."""
        try:
            self.data_dir.mkdir(parents=True, exist_ok=True)
            (self.data_dir / "data" / "data").mkdir(parents=True, exist_ok=True)
            return True
        except Exception as e:
            logger.error(f"Failed to create wrapper data directory: {e}")
            return False
    
    def _stop_existing_container(self):
        """Stop and remove any existing container with our name."""
        try:
            subprocess.run(["docker", "stop", CONTAINER_NAME], capture_output=True, timeout=30)
            subprocess.run(["docker", "rm", "-f", CONTAINER_NAME], capture_output=True, timeout=10)
        except Exception:
            pass
    
    def is_running(self) -> bool:
        """Check if the wrapper container is running."""
        try:
            result = subprocess.run(
                ["docker", "ps", "-q", "-f", f"name={CONTAINER_NAME}"],
                capture_output=True,
                text=True,
                timeout=10,
            )
            return result.returncode == 0 and result.stdout.strip() != ""
        except Exception:
            return False
    
    def has_saved_session(self) -> bool:
        """Check if a saved session exists (can skip login)."""
        storefront_file = self.data_dir / "data" / "data" / "com.apple.android.music" / "files" / "STOREFRONT_ID"
        return storefront_file.exists()
    
    def start(self) -> bool:
        """
        Start the wrapper Docker container.
        
        If a saved session exists, starts without login.
        Otherwise starts in headless mode for web-based auth.
        """
        docker_ok, image_ok, message = self.get_availability()
        if not docker_ok or not image_ok:
            logger.error(f"Cannot start wrapper: {message}")
            return False
        
        if not self._ensure_data_dir():
            return False
        
        self._stop_existing_container()
        
        # Check if we have a saved session
        if self.has_saved_session():
            # Start without login - session will be restored
            args = "-H 0.0.0.0"
        else:
            # Start in headless mode for web-based auth
            args = "-H 0.0.0.0 -X"
        
        cmd = [
            "docker", "run",
            "-d",
            "--name", CONTAINER_NAME,
            "-p", f"{self.decrypt_port}:{self.decrypt_port}",
            "-p", f"{self.m3u8_port}:{self.m3u8_port}",
            "-p", f"{self.account_port}:{self.account_port}",
            "-p", f"{self.auth_port}:{self.auth_port}",
            "-v", f"{self.data_dir}/data:/app/rootfs/data",
            "-e", f"args={args}",
            DOCKER_IMAGE,
        ]
        
        logger.info(f"Starting wrapper container")
        
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
            
            if result.returncode != 0:
                logger.error(f"Failed to start container: {result.stderr}")
                return False
            
            self._container_id = result.stdout.strip()
            self._started = True
            logger.info(f"Wrapper container started: {self._container_id[:12]}")
            return True
        except Exception as e:
            logger.error(f"Failed to start wrapper: {e}")
            return False
    
    async def wait_ready(self, timeout: float = 30.0) -> bool:
        """Wait for the wrapper to be ready (listening on decrypt port)."""
        import asyncio
        start_time = asyncio.get_event_loop().time()
        while asyncio.get_event_loop().time() - start_time < timeout:
            try:
                sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                sock.settimeout(1.0)
                result = sock.connect_ex((self.host, self.decrypt_port))
                sock.close()
                if result == 0:
                    return True
            except Exception:
                pass
            await asyncio.sleep(0.5)
        return False
    
    def get_logs(self, tail: int = 50) -> str:
        """Get recent container logs (alias for get_container_logs)."""
        return self.get_container_logs(lines=tail)
    
    def start_headless(self) -> bool:
        """
        Start the wrapper Docker container in headless mode.
        The container will listen on auth port for credentials via socket.
        
        Returns:
            True if started successfully, False otherwise
        """
        docker_ok, image_ok, message = self.get_availability()
        if not docker_ok or not image_ok:
            logger.error(f"Cannot start wrapper: {message}")
            return False
        
        if not self._ensure_data_dir():
            return False
        
        self._stop_existing_container()
        
        # Build Docker run command with headless mode
        args = f"-H 0.0.0.0 -X"  # Headless mode
        
        cmd = [
            "docker", "run",
            "-d",
            "--name", CONTAINER_NAME,
            "-p", f"{self.decrypt_port}:{self.decrypt_port}",
            "-p", f"{self.m3u8_port}:{self.m3u8_port}",
            "-p", f"{self.account_port}:{self.account_port}",
            "-p", f"{self.auth_port}:{self.auth_port}",
            "-v", f"{self.data_dir}/data:/app/rootfs/data",
            "-e", f"args={args}",
            DOCKER_IMAGE,
        ]
        
        logger.info(f"Starting wrapper container in headless mode")
        
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
            
            if result.returncode != 0:
                logger.error(f"Failed to start container: {result.stderr}")
                return False
            
            self._container_id = result.stdout.strip()
            self._started = True
            logger.info(f"Wrapper container started: {self._container_id[:12]}")
            return True
        except Exception as e:
            logger.error(f"Failed to start wrapper: {e}")
            return False
    
    def connect_auth_socket(self, timeout: float = 10.0) -> bool:
        """
        Connect to the wrapper's auth socket.
        
        Args:
            timeout: Connection timeout in seconds
            
        Returns:
            True if connected, False otherwise
        """
        if self._auth_connected:
            return True
        
        try:
            self._auth_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            self._auth_socket.settimeout(timeout)
            self._auth_socket.connect((self.host, self.auth_port))
            self._auth_connected = True
            logger.info(f"Connected to wrapper auth socket on port {self.auth_port}")
            return True
        except Exception as e:
            logger.error(f"Failed to connect to auth socket: {e}")
            if self._auth_socket:
                self._auth_socket.close()
                self._auth_socket = None
            return False
    
    def _send_auth_message(self, data: dict) -> bool:
        """Send a JSON message to the wrapper auth socket."""
        if not self._auth_socket:
            return False
        try:
            json_str = json.dumps(data)
            json_bytes = json_str.encode('utf-8')
            length = struct.pack('>I', len(json_bytes))
            self._auth_socket.sendall(length + json_bytes)
            return True
        except Exception as e:
            logger.error(f"Failed to send auth message: {e}")
            return False
    
    def _recv_auth_message(self, timeout: float = 60.0) -> Optional[dict]:
        """Receive a JSON message from the wrapper auth socket."""
        if not self._auth_socket:
            print("[WRAPPER-MGR] No auth socket", flush=True)
            return None
        try:
            self._auth_socket.settimeout(timeout)
            length_data = self._auth_socket.recv(4)
            if len(length_data) < 4:
                print(f"[WRAPPER-MGR] Short length read: {len(length_data)}", flush=True)
                return None
            length = struct.unpack('>I', length_data)[0]
            if length > 65536:
                print(f"[WRAPPER-MGR] Length too large: {length}", flush=True)
                return None
            json_bytes = b''
            while len(json_bytes) < length:
                chunk = self._auth_socket.recv(length - len(json_bytes))
                if not chunk:
                    print("[WRAPPER-MGR] Empty chunk", flush=True)
                    return None
                json_bytes += chunk
            msg = json.loads(json_bytes.decode('utf-8'))
            print(f"[WRAPPER-MGR] Received: {msg.get('type', 'unknown')}", flush=True)
            return msg
        except socket.timeout:
            logger.debug("Auth socket recv timeout")
            return None
        except Exception as e:
            logger.error(f"Failed to recv auth message: {e}")
            print(f"[WRAPPER-MGR] Recv exception: {e}", flush=True)
            return None
    
    def submit_credentials(self, username: str, password: str) -> bool:
        """Submit login credentials to the wrapper."""
        return self._send_auth_message({
            "type": "credentials",
            "username": username,
            "password": password
        })
    
    def submit_otp(self, code: str) -> bool:
        """Submit 2FA OTP code to the wrapper."""
        return self._send_auth_message({
            "type": "otp",
            "code": code
        })
    
    async def run_auth_loop(
        self,
        on_credentials_request: Callable[[dict], None],
        on_dialog: Callable[[dict], None],
        on_auth_success: Callable[[dict], None],
        on_auth_failed: Callable[[dict], None],
    ):
        """
        Run the auth message loop, calling callbacks for each message type.
        
        This should be run in an asyncio task. It will block until auth
        succeeds, fails, or the connection is closed.
        """
        self._on_credentials_request = on_credentials_request
        self._on_dialog = on_dialog
        self._on_auth_success = on_auth_success
        self._on_auth_failed = on_auth_failed
        
        while self._auth_connected:
            # Use asyncio to make recv non-blocking
            msg = await asyncio.get_event_loop().run_in_executor(
                None, lambda: self._recv_auth_message(timeout=120.0)
            )
            
            if msg is None:
                continue
            
            msg_type = msg.get("type", "")
            logger.info(f"Received auth message: {msg_type}")
            
            if msg_type == "credentials_request":
                if self._on_credentials_request:
                    self._on_credentials_request(msg)
            elif msg_type == "dialog":
                if self._on_dialog:
                    self._on_dialog(msg)
            elif msg_type == "auth_success":
                if self._on_auth_success:
                    self._on_auth_success(msg)
                break  # Auth complete
            elif msg_type == "auth_failed":
                if self._on_auth_failed:
                    self._on_auth_failed(msg)
                break  # Auth failed
    
    def stop(self) -> bool:
        """Stop the wrapper container using force removal."""
        if self._auth_socket:
            try:
                self._auth_socket.close()
            except Exception:
                pass
            self._auth_socket = None
            self._auth_connected = False
        
        try:
            # Use force removal directly to avoid timeout issues
            subprocess.run(["docker", "rm", "-f", CONTAINER_NAME], capture_output=True, timeout=5)
            self._started = False
            self._container_id = None
            return True
        except Exception as e:
            logger.error(f"Failed to stop wrapper: {e}")
            return False
    
    def get_container_logs(self, lines: int = 50) -> str:
        """Get recent container logs."""
        try:
            result = subprocess.run(
                ["docker", "logs", "--tail", str(lines), CONTAINER_NAME],
                capture_output=True,
                text=True,
                timeout=10,
            )
            return result.stdout + result.stderr
        except Exception:
            return ""


# Module-level singleton
_wrapper_manager: Optional[DockerWrapperManager] = None


def get_wrapper_manager() -> DockerWrapperManager:
    """Get the singleton wrapper manager instance."""
    global _wrapper_manager
    if _wrapper_manager is None:
        _wrapper_manager = DockerWrapperManager()
    return _wrapper_manager


def check_wrapper_available() -> Tuple[bool, str]:
    """Check if wrapper is available (Docker + image)."""
    mgr = get_wrapper_manager()
    docker_ok, image_ok, message = mgr.get_availability()
    return docker_ok and image_ok, message


def stop_wrapper():
    """Stop the wrapper container."""
    mgr = get_wrapper_manager()
    return mgr.stop()
