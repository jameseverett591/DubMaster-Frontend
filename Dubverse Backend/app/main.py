from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import logging
import os
import sys

from app.config import get_settings
from app.api import routes
from app.storage.manager import setup_storage_dirs

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    logger.info(f"Starting {settings.APP_NAME} v{settings.APP_VERSION}")
    
    setup_storage_dirs()
    logger.info("Storage directories initialized")
    
    yield
    
    logger.info("Shutting down application")


app = FastAPI(
    title="Dubverse Backend API",
    description="AI-powered video dubbing platform backend",
    version="1.0.0",
    lifespan=lifespan
)

settings = get_settings()

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(routes.router, prefix="/api")


@app.get("/")
async def root():
    return {
        "service": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "status": "operational"
    }


@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "service": settings.APP_NAME
    }


@app.get("/debug/runtime")
async def debug_runtime():
    return {
        "python_executable": sys.executable,
        "python_version": sys.version,
        "prefix": sys.prefix,
        "cwd": os.getcwd(),
    }
