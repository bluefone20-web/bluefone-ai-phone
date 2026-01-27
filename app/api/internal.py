"""
Internal API endpoints for operations/monitoring.
These should NOT be exposed to the public internet.
"""
from fastapi import APIRouter, Request
from datetime import datetime
import logging
from app.services import sheet_service
from app.core.config import settings

internal_router = APIRouter(prefix="/internal", tags=["internal"])
logger = logging.getLogger(__name__)

@internal_router.post("/warmup")
async def warmup_cache(request: Request):
    """
    Pre-warm the Sheets cache.
    Call this via cron every 10 minutes to ensure config is ready.
    """
    start = datetime.utcnow()
    tenants_warmed = []
    errors = []
    
    # Warm up all known tenants
    for tenant_id in sheet_service.TENANT_MAP.keys():
        try:
            # Force cache refresh by getting config
            config = sheet_service.get_tenant_config(tenant_id)
            if config:
                tenants_warmed.append(tenant_id)
                logger.info(f"Warmed cache for {tenant_id}")
        except Exception as e:
            errors.append({"tenant": tenant_id, "error": str(e)})
            logger.error(f"Failed to warm cache for {tenant_id}: {e}")
    
    elapsed = (datetime.utcnow() - start).total_seconds()
    
    return {
        "status": "ok" if not errors else "partial",
        "tenants_warmed": tenants_warmed,
        "errors": errors,
        "elapsed_seconds": elapsed
    }

@internal_router.get("/status")
async def detailed_status(request: Request):
    """
    Detailed server status for monitoring.
    Returns uptime, call stats, cache status, etc.
    """
    app = request.app
    now = datetime.utcnow()
    
    # Calculate uptime
    started_at = getattr(app.state, 'started_at', now)
    uptime_seconds = (now - started_at).total_seconds()
    
    # Call stats
    last_call = getattr(app.state, 'last_call_at', None)
    call_count = getattr(app.state, 'call_count', 0)
    
    # Check Sheets connectivity
    sheets_status = "unknown"
    if settings.MOCK_MODE:
        sheets_status = "mock_mode"
    else:
        try:
            client = sheet_service.get_gspread_client()
            sheets_status = "connected" if client else "no_credentials"
        except Exception as e:
            sheets_status = f"error: {str(e)}"
    
    # Cache info
    cache_info = {
        "ttl_seconds": settings.SHEET_CACHE_TTL,
        "current_size": len(sheet_service.msg_cache),
        "max_size": sheet_service.msg_cache.maxsize
    }
    
    return {
        "status": "healthy",
        "timestamp": now.isoformat(),
        "uptime": {
            "seconds": int(uptime_seconds),
            "human": _format_uptime(uptime_seconds)
        },
        "calls": {
            "total": call_count,
            "last_call_at": last_call.isoformat() if last_call else None
        },
        "sheets": {
            "status": sheets_status,
            "mock_mode": settings.MOCK_MODE
        },
        "cache": cache_info,
        "config": {
            "sendgrid_configured": bool(settings.SENDGRID_API_KEY),
            "openai_configured": bool(settings.OPENAI_API_KEY),
            "twilio_configured": bool(settings.TWILIO_ACCOUNT_SID)
        }
    }

@internal_router.post("/clear-cache")
async def clear_cache():
    """Clear all cached data (for debugging/emergency)"""
    sheet_service.msg_cache.clear()
    logger.warning("Cache cleared manually via /internal/clear-cache")
    return {"status": "ok", "message": "Cache cleared"}

def _format_uptime(seconds: float) -> str:
    """Format seconds into human readable uptime"""
    days = int(seconds // 86400)
    hours = int((seconds % 86400) // 3600)
    minutes = int((seconds % 3600) // 60)
    
    if days > 0:
        return f"{days}d {hours}h {minutes}m"
    elif hours > 0:
        return f"{hours}h {minutes}m"
    else:
        return f"{minutes}m"
