#!/bin/bash
# setup.sh - Complete setup script for st0rmMusic
# Run this after cloning the repository to set up everything needed for production

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}   st0rmMusic Setup Script${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# =============================================================================
# Check System Requirements
# =============================================================================
echo -e "${YELLOW}[1/6] Checking system requirements...${NC}"

# Check Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}Error: Node.js is not installed${NC}"
    echo "Please install Node.js 18+ from https://nodejs.org/"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo -e "${RED}Error: Node.js 18+ is required (found v$NODE_VERSION)${NC}"
    exit 1
fi
echo -e "  ${GREEN}✓${NC} Node.js $(node -v)"

# Check npm
if ! command -v npm &> /dev/null; then
    echo -e "${RED}Error: npm is not installed${NC}"
    exit 1
fi
echo -e "  ${GREEN}✓${NC} npm $(npm -v)"

# Check Python3
if ! command -v python3 &> /dev/null; then
    echo -e "${RED}Error: Python 3 is not installed${NC}"
    echo "Please install Python 3.9+ from https://www.python.org/"
    exit 1
fi

PYTHON_VERSION=$(python3 -c 'import sys; print(sys.version_info.minor)')
if [ "$PYTHON_VERSION" -lt 9 ]; then
    echo -e "${RED}Error: Python 3.9+ is required${NC}"
    exit 1
fi
echo -e "  ${GREEN}✓${NC} Python $(python3 --version)"

# Check for python3-venv (required for virtual environment)
if ! python3 -m venv --help &> /dev/null; then
    echo -e "${RED}Error: python3-venv is not installed${NC}"
    echo "Install it with: sudo apt install python3-venv (Debian/Ubuntu)"
    exit 1
fi
echo -e "  ${GREEN}✓${NC} python3-venv"

echo ""

# =============================================================================
# Install Node.js Dependencies
# =============================================================================
echo -e "${YELLOW}[2/6] Installing Node.js dependencies...${NC}"
npm install
echo -e "  ${GREEN}✓${NC} Node.js dependencies installed"
echo ""

# =============================================================================
# Setup Prisma Database
# =============================================================================
echo -e "${YELLOW}[3/6] Setting up database...${NC}"

# Create .env file if it doesn't exist
if [ ! -f ".env" ]; then
    echo 'DATABASE_URL="file:./library.db"' > .env
    echo -e "  ${GREEN}✓${NC} Created .env file"
else
    echo -e "  ${GREEN}✓${NC} .env file already exists"
fi

# Generate Prisma client
echo "  Generating Prisma client..."
npx prisma generate

# Create/update database schema (Prisma handles this gracefully)
echo "  Syncing database schema..."
npx prisma db push
echo -e "  ${GREEN}✓${NC} Database ready"

echo ""

# =============================================================================
# Setup Python Virtual Environment
# =============================================================================
echo -e "${YELLOW}[4/6] Setting up Python environment...${NC}"

VENV_DIR="$SCRIPT_DIR/scripts/venv"
REQUIREMENTS=(
    "fastapi"
    "uvicorn"
    "sse-starlette"
    "pydantic"
    "gamdl"
    "mutagen"
    "python-dateutil"
    "apscheduler"
    "websockets"
)

if [ ! -d "$VENV_DIR" ]; then
    echo "  Creating Python virtual environment..."
    python3 -m venv "$VENV_DIR"

    echo "  Installing Python dependencies..."
    "$VENV_DIR/bin/pip" install --upgrade pip --quiet

    for pkg in "${REQUIREMENTS[@]}"; do
        echo "    Installing $pkg..."
        "$VENV_DIR/bin/pip" install "$pkg" --quiet
    done

    echo -e "  ${GREEN}✓${NC} Python environment created"
else
    echo -e "  ${GREEN}✓${NC} Python environment already exists"

    # Optionally update packages
    echo "  Checking for missing packages..."
    for pkg in "${REQUIREMENTS[@]}"; do
        if ! "$VENV_DIR/bin/pip" show "$pkg" &> /dev/null; then
            echo "    Installing missing: $pkg..."
            "$VENV_DIR/bin/pip" install "$pkg" --quiet
        fi
    done
fi

echo ""

# =============================================================================
# Build Next.js for Production
# =============================================================================
echo -e "${YELLOW}[5/6] Building Next.js application...${NC}"
npm run build
echo -e "  ${GREEN}✓${NC} Next.js build complete"
echo ""

# =============================================================================
# Final Instructions
# =============================================================================
echo -e "${YELLOW}[6/6] Setup complete!${NC}"
echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}   Setup Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "To start the application:"
echo -e "  ${BLUE}npm start${NC}"
echo ""
echo -e "The app will be available at:"
echo -e "  ${BLUE}http://localhost:3000${NC}"
echo ""
echo -e "Optional: Configure Apple Music cookies in Settings > Import"
echo -e "to enable downloading from Apple Music."
echo ""
