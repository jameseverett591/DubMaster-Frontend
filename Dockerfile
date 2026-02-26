# ============================================
# DUBVERSE FRONTEND DOCKERFILE
# Next.js + React 19 + Tailwind CSS v4
# ============================================

# ============================================
# DEVELOPMENT STAGE
# ============================================
FROM node:20-alpine AS development

WORKDIR /app

# Install system dependencies for native modules
RUN apk add --no-cache libc6-compat

# Copy package files
COPY package.json package-lock.json ./

# Install dependencies
RUN npm ci

# Install Alpine/musl-specific native binaries (version-matched)
RUN npm install --no-save \
    lightningcss-linux-x64-musl@1.30.2 \
    @tailwindcss/oxide-linux-x64-musl@4.1.18 \
    @img/sharp-linux-x64@0.34.2

# Copy application code
COPY . .

# Expose port
EXPOSE 3001

# Use webpack instead of Turbopack (Turbopack panics on Alpine/musl)
CMD ["npx", "next", "dev", "-p", "3001", "--webpack"]
