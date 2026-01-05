import socket
import struct
import logging
from typing import Optional

# Configuration
WRAPPER_HOST = "127.0.0.1"
WRAPPER_M3U8_PORT = 20020
WRAPPER_DECRYPT_PORT = 10020

logger = logging.getLogger(__name__)


class WrapperClient:
    """Client for communicating with the wrapper decryption service."""
    
    def __init__(self, host: str = WRAPPER_HOST, timeout: float = 30.0):
        self.host = host
        self.timeout = timeout

    def health_check(self) -> bool:
        """Check if the wrapper service is responding."""
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.settimeout(2)
                result = s.connect_ex((self.host, WRAPPER_M3U8_PORT))
                return result == 0
        except Exception:
            return False

    def fetch_m3u8_url(self, adam_id: str) -> str:
        """Fetch M3U8 URL from Wrapper service (Port 20020)."""
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.settimeout(self.timeout)
                s.connect((self.host, WRAPPER_M3U8_PORT))
                
                # Protocol: 1 byte len + adamId string
                adam_bytes = adam_id.encode("utf-8")
                s.sendall(struct.pack("B", len(adam_bytes)))
                s.sendall(adam_bytes)
                
                # Read response (URL ends with newline)
                data = b""
                while True:
                    chunk = s.recv(1)
                    if not chunk:
                        break
                    data += chunk
                    if chunk == b"\n":
                        break
                
                url = data.decode("utf-8").strip()
                if not url or url == "\n":
                    raise Exception("Empty M3U8 URL from wrapper")
                return url
        except Exception as e:
            logger.error(f"Failed to fetch M3U8 URL from wrapper: {e}")
            raise

    def get_decryptor(self, adam_id: str, key_uri: str) -> "Decryptor":
        """
        Get a decryptor context manager for the given track.
        
        Args:
            adam_id: Apple Music track ID
            key_uri: FairPlay key URI (skd://...)
            
        Returns:
            Decryptor context manager for decrypting segments
        """
        return Decryptor(self.host, adam_id, key_uri, self.timeout)


class Decryptor:
    """Context manager for FairPlay decryption via wrapper service."""
    
    def __init__(self, host: str, adam_id: str, key_uri: str, timeout: float = 30.0):
        self.host = host
        self.sock: Optional[socket.socket] = None
        self.adam_id = adam_id
        self.key_uri = key_uri
        self.timeout = timeout
    
    def __enter__(self):
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect((self.host, WRAPPER_DECRYPT_PORT))
        
        # Protocol Init:
        # 1 byte adamLen + adamId
        # 1 byte uriLen + uri
        adam_bytes = self.adam_id.encode("utf-8")
        uri_bytes = self.key_uri.encode("utf-8")
        
        self.sock.sendall(struct.pack("B", len(adam_bytes)))
        self.sock.sendall(adam_bytes)
        
        self.sock.sendall(struct.pack("B", len(uri_bytes)))
        self.sock.sendall(uri_bytes)
        return self

    def decrypt(self, encrypted_data: bytes) -> bytes:
        """Decrypt a chunk of encrypted data."""
        if not self.sock:
            raise RuntimeError("Decryptor not initialized - use as context manager")
            
        length = len(encrypted_data)
        if length == 0:
            return b""
            
        self.sock.sendall(struct.pack("<I", length))
        self.sock.sendall(encrypted_data)
        
        decrypted = bytearray()
        remaining = length
        while remaining > 0:
            chunk = self.sock.recv(min(remaining, 65536))
            if not chunk:
                raise IOError("Connection closed during decryption")
            decrypted.extend(chunk)
            remaining -= len(chunk)
        
        return bytes(decrypted)

    def __exit__(self, exc_type, exc_val, exc_tb):
        if self.sock:
            try:
                # Send zero-length to signal end of session
                self.sock.sendall(struct.pack("<I", 0))
            except Exception:
                pass
            self.sock.close()
            self.sock = None
