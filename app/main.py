from fastapi import FastAPI
from app.api.routes import router
from app.api.internal import internal_router
import logging
from datetime import datetime

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)

app = FastAPI(title="Bluefone IVR", version="1.0.0")

# Track server start time
app.state.started_at = datetime.utcnow()
app.state.last_call_at = None
app.state.call_count = 0

app.include_router(router)
app.include_router(internal_router)

@app.get("/")
async def root():
    return {"message": "Bluefone IVR System Operational"}

@app.get("/health")
async def health():
    """Health check endpoint - simple and fast"""
    return {"status": "healthy", "service": "bluefone-ivr"}
