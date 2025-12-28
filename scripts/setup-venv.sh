#!/bin/bash
# scripts/setup-venv.sh - Setup Python virtual environment if not present

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="$SCRIPT_DIR/venv"
REQUIREMENTS=(
    "fastapi"
    "uvicorn"
    "sse-starlette"
    "pydantic"
    "gamdl"
    "mutagen"
    "python-dateutil"
    "apscheduler"
)

# Check if venv exists
if [ ! -d "$VENV_DIR" ]; then
    echo "🐍 Creating Python virtual environment..."
    python3 -m venv "$VENV_DIR"
    
    echo "📦 Installing dependencies..."
    "$VENV_DIR/bin/pip" install --upgrade pip
    
    for pkg in "${REQUIREMENTS[@]}"; do
        echo "  Installing $pkg..."
        "$VENV_DIR/bin/pip" install "$pkg" --quiet
    done
    
    echo "✅ Python environment ready!"
else
    echo "✅ Python venv already exists"
fi

# Run the gamdl service
echo "🎵 Starting gamdl service..."
exec "$VENV_DIR/bin/python" "$SCRIPT_DIR/gamdl_service.py" "$@"
