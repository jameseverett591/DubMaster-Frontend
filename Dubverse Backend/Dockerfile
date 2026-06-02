# ============================================
# DUBVERSE BACKEND DOCKERFILE
# Python 3.11 + FastAPI + ML Libraries
# ============================================

FROM python:3.11-slim

# Prevent Python from buffering stdout/stderr
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

# Set working directory
WORKDIR /app

# ============================================
# INSTALL SYSTEM DEPENDENCIES
# ============================================
RUN apt-get update && apt-get install -y \
    # FFmpeg for audio/video processing
    ffmpeg \
    librubberband2 \
    rubberband-cli \
    # Build tools for Python packages
    build-essential \
    # Audio processing libraries
    libsndfile1 \
    libsndfile1-dev \
    # Utilities
    curl \
    git \
    # Cleanup
    && rm -rf /var/lib/apt/lists/*

# ============================================
# INSTALL PYTHON DEPENDENCIES
# ============================================
# Copy requirements first (Docker layer caching)
COPY requirements.txt .

# Install Python packages
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Note: If you don't have requirements.txt yet, download it from the Docker setup package

# ============================================
# VERIFY CRITICAL DEPENDENCIES
# ============================================
RUN python -c "import torch; print(f'✓ PyTorch {torch.__version__}')" && \
    python -c "import fastapi; print(f'✓ FastAPI {fastapi.__version__}')" && \
    python -c "import edge_tts; print('✓ Edge TTS installed')" && \
    echo "✓ All critical dependencies verified"

# ============================================
# COPY APPLICATION CODE
# ============================================
COPY ./app /app/app

# Create necessary directories
RUN mkdir -p /app/data /app/uploads /app/outputs /app/logs

# ============================================
# HEALTHCHECK
# ============================================
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# ============================================
# RUN APPLICATION
# ============================================
EXPOSE 8000

# Use uvicorn without reload to avoid interrupting long-running uploads/pipelines
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

# For production, use:
# CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "4"]
