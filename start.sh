#!/bin/bash

# ============================================
# DUBVERSE MASTER STARTUP SCRIPT
# ============================================
# This script:
# - Validates environment and dependencies
# - Starts Docker containers
# - Monitors health and provides logs
# ============================================

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ============================================
# UTILITY FUNCTIONS
# ============================================

print_header() {
    echo -e "${BLUE}╔════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║${NC}  🎬 DUBVERSE STARTUP                          ${BLUE}║${NC}"
    echo -e "${BLUE}╚════════════════════════════════════════════════╝${NC}"
    echo ""
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

print_info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

# ============================================
# PRE-FLIGHT CHECKS
# ============================================

check_docker() {
    if ! command -v docker &> /dev/null; then
        print_error "Docker is not installed!"
        echo "Install from: https://docs.docker.com/get-docker/"
        exit 1
    fi
    print_success "Docker is installed ($(docker --version))"
}

check_docker_compose() {
    if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
        print_error "Docker Compose is not installed!"
        echo "Install from: https://docs.docker.com/compose/install/"
        exit 1
    fi
    print_success "Docker Compose is installed"
}

check_env_file() {
    if [ ! -f ".env" ]; then
        print_warning ".env file not found!"
        echo "Creating .env from .env.example..."
        if [ -f ".env.example" ]; then
            cp .env.example .env
            print_info "Please edit .env and add your API keys"
            exit 1
        else
            print_error ".env.example not found!"
            exit 1
        fi
    fi
    print_success ".env file exists"
}

check_api_keys() {
    if ! grep -q "your_.*_key_here" .env 2>/dev/null; then
        print_success "API keys appear to be configured"
    else
        print_warning "Some API keys may not be configured in .env"
        echo "Please verify: ELEVENLABS_API_KEY, DEEPL_API_KEY, HUGGING_FACE_TOKEN"
    fi
}

check_ports() {
    if lsof -Pi :8000 -sTCP:LISTEN -t >/dev/null 2>&1; then
        print_warning "Port 8000 is already in use!"
        echo "Stop the process or Docker will fail to start"
        lsof -i :8000
    fi
    
    if lsof -Pi :3000 -sTCP:LISTEN -t >/dev/null 2>&1; then
        print_warning "Port 3000 is already in use!"
        echo "Stop the process or Docker will fail to start"
        lsof -i :3000
    fi
}

# ============================================
# MAIN STARTUP SEQUENCE
# ============================================

print_header

echo "🔍 Running pre-flight checks..."
echo ""

check_docker
check_docker_compose
check_env_file
check_api_keys
check_ports

echo ""
print_success "All pre-flight checks passed!"
echo ""

# ============================================
# BUILD & START CONTAINERS
# ============================================

print_info "Building Docker images..."
docker-compose build

echo ""
print_info "Starting containers..."
docker-compose up -d

echo ""
print_info "Waiting for services to be healthy..."
sleep 5

# ============================================
# HEALTH CHECK
# ============================================

echo ""
echo "🏥 Checking service health..."
echo ""

# Check backend
if curl -f http://localhost:8000/health &> /dev/null; then
    print_success "Backend is healthy (http://localhost:8000)"
else
    print_error "Backend health check failed!"
    print_info "Checking logs:"
    docker-compose logs --tail=20 backend
fi

# Check frontend
if curl -f http://localhost:3000 &> /dev/null; then
    print_success "Frontend is healthy (http://localhost:3000)"
else
    print_warning "Frontend may still be starting up..."
fi

echo ""
echo -e "${GREEN}╔════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║${NC}  ✅ DUBVERSE IS RUNNING                        ${GREEN}║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════╝${NC}"
echo ""
echo "📊 Access points:"
echo "   Frontend:  http://localhost:3000"
echo "   Backend:   http://localhost:8000"
echo "   API Docs:  http://localhost:8000/docs"
echo ""
echo "📝 Useful commands:"
echo "   View logs:    docker-compose logs -f"
echo "   Stop all:     docker-compose down"
echo "   Restart:      docker-compose restart"
echo "   Status:       docker-compose ps"
echo ""
print_info "Press Ctrl+C to view live logs (won't stop containers)"
echo ""

# Show live logs
docker-compose logs -f
