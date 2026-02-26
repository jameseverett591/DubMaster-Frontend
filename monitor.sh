#!/bin/bash

# ============================================
# DUBVERSE MONITORING & TROUBLESHOOTING
# ============================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m'

# ============================================
# MENU SYSTEM
# ============================================

show_menu() {
    clear
    echo -e "${BLUE}╔════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║${NC}  🔧 DUBVERSE MONITORING & TROUBLESHOOTING     ${BLUE}║${NC}"
    echo -e "${BLUE}╚════════════════════════════════════════════════╝${NC}"
    echo ""
    echo "1) 📊 View Service Status"
    echo "2) 📝 View Live Logs (all services)"
    echo "3) 🔍 View Backend Logs Only"
    echo "4) 🔍 View Frontend Logs Only"
    echo "5) 🏥 Run Health Checks"
    echo "6) 💾 Check ElevenLabs Quota"
    echo "7) 🔄 Restart Services"
    echo "8) 🗑️  Clean & Rebuild"
    echo "9) 🐛 Enter Debug Mode (shell in container)"
    echo "10) 📈 Show Resource Usage"
    echo "0) 🚪 Exit"
    echo ""
    echo -n "Select option: "
}

# ============================================
# FUNCTIONS
# ============================================

service_status() {
    echo -e "${CYAN}=== Service Status ===${NC}"
    docker-compose ps
    echo ""
    echo -e "${CYAN}=== Container Resource Usage ===${NC}"
    docker stats --no-stream
}

view_all_logs() {
    echo -e "${CYAN}=== Live Logs (Ctrl+C to exit) ===${NC}"
    docker-compose logs -f
}

view_backend_logs() {
    echo -e "${CYAN}=== Backend Logs (Ctrl+C to exit) ===${NC}"
    docker-compose logs -f backend
}

view_frontend_logs() {
    echo -e "${CYAN}=== Frontend Logs (Ctrl+C to exit) ===${NC}"
    docker-compose logs -f frontend
}

health_checks() {
    echo -e "${CYAN}=== Health Check Results ===${NC}"
    echo ""
    
    # Backend health
    echo -n "Backend (8000): "
    if curl -sf http://localhost:8000/health > /dev/null; then
        echo -e "${GREEN}✓ Healthy${NC}"
        echo "  Response: $(curl -s http://localhost:8000/health | jq -r '.status' 2>/dev/null || echo 'OK')"
    else
        echo -e "${RED}✗ Unhealthy${NC}"
    fi
    
    # Frontend health
    echo -n "Frontend (3000): "
    if curl -sf http://localhost:3000 > /dev/null; then
        echo -e "${GREEN}✓ Healthy${NC}"
    else
        echo -e "${RED}✗ Unhealthy${NC}"
    fi
    
    # Check Docker health status
    echo ""
    echo "Docker Health Status:"
    docker-compose ps | grep -E "(healthy|unhealthy|starting)" || echo "No health status available"
}

check_elevenlabs_quota() {
    echo -e "${CYAN}=== Checking ElevenLabs Quota ===${NC}"
    echo ""
    
    # Try to get quota from backend
    response=$(curl -s http://localhost:8000/api/quota/elevenlabs 2>/dev/null)
    
    if [ $? -eq 0 ]; then
        echo "$response" | jq . 2>/dev/null || echo "$response"
    else
        echo -e "${YELLOW}⚠ Could not fetch quota. Backend may not be running.${NC}"
        echo ""
        echo "You can also check manually at:"
        echo "https://elevenlabs.io/app/usage"
    fi
}

restart_services() {
    echo -e "${CYAN}=== Restarting Services ===${NC}"
    docker-compose restart
    echo -e "${GREEN}✓ Services restarted${NC}"
    sleep 2
}

clean_rebuild() {
    echo -e "${YELLOW}⚠ This will stop containers, remove volumes, and rebuild from scratch.${NC}"
    echo -n "Continue? (y/N): "
    read -r confirm
    
    if [[ $confirm =~ ^[Yy]$ ]]; then
        echo -e "${CYAN}=== Stopping containers ===${NC}"
        docker-compose down -v
        
        echo -e "${CYAN}=== Removing old images ===${NC}"
        docker-compose down --rmi local
        
        echo -e "${CYAN}=== Rebuilding ===${NC}"
        docker-compose build --no-cache
        
        echo -e "${CYAN}=== Starting fresh ===${NC}"
        docker-compose up -d
        
        echo -e "${GREEN}✓ Clean rebuild complete${NC}"
    else
        echo "Cancelled."
    fi
}

debug_mode() {
    echo -e "${CYAN}=== Debug Mode ===${NC}"
    echo "Select container to debug:"
    echo "1) Backend"
    echo "2) Frontend"
    echo -n "Choice: "
    read -r choice
    
    case $choice in
        1)
            echo -e "${CYAN}Opening shell in backend container...${NC}"
            docker-compose exec backend /bin/bash
            ;;
        2)
            echo -e "${CYAN}Opening shell in frontend container...${NC}"
            docker-compose exec frontend /bin/sh
            ;;
        *)
            echo "Invalid choice"
            ;;
    esac
}

resource_usage() {
    echo -e "${CYAN}=== Resource Usage ===${NC}"
    echo ""
    echo "Container Stats:"
    docker stats --no-stream --format "table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}"
    echo ""
    echo "Disk Usage:"
    docker system df
}

# ============================================
# MAIN LOOP
# ============================================

while true; do
    show_menu
    read -r choice
    
    case $choice in
        1) service_status; read -p "Press Enter to continue..." ;;
        2) view_all_logs ;;
        3) view_backend_logs ;;
        4) view_frontend_logs ;;
        5) health_checks; read -p "Press Enter to continue..." ;;
        6) check_elevenlabs_quota; read -p "Press Enter to continue..." ;;
        7) restart_services; read -p "Press Enter to continue..." ;;
        8) clean_rebuild; read -p "Press Enter to continue..." ;;
        9) debug_mode ;;
        10) resource_usage; read -p "Press Enter to continue..." ;;
        0) echo "Goodbye!"; exit 0 ;;
        *) echo "Invalid option"; sleep 1 ;;
    esac
done
