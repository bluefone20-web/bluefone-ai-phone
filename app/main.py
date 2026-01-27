from fastapi import FastAPI
from app.api.routes import router
import logging

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)

app = FastAPI(title="Bluefone IVR", version="1.0.0")

app.include_router(router)

@app.get("/")
async def root():
    return {"message": "Bluefone IVR System Operational"}

@app.get("/health")
async def health():
    """Health check endpoint for Render/Railway deployment"""
    return {"status": "healthy", "service": "bluefone-ivr"}
