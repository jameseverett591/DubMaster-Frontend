#!/bin/bash

# ============================================
# DUBVERSE STOP SCRIPT
# ============================================

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo ""
echo -e "${YELLOW}Stopping DubVerse containers...${NC}"
echo ""

docker-compose down

echo ""
echo -e "${GREEN}✓ All containers stopped${NC}"
echo ""
echo "To start again: ./start.sh"
echo "To remove volumes too: docker-compose down -v"
echo ""
