from fastapi import APIRouter, Request, Response, Form, BackgroundTasks
import logging
from typing import Optional
from cachetools import TTLCache
from app.services import sheet_service, voice_service, processing_service

router = APIRouter()
logger = logging.getLogger(__name__)

# In-memory store for call context (menu selection, call status)
# TTL 1 hour - enough time to complete call processing
call_context_cache = TTLCache(maxsize=1000, ttl=3600)

def _get_call_context(call_sid: str) -> dict:
    """Get call context or return empty dict"""
    return call_context_cache.get(call_sid, {})

def _update_call_context(call_sid: str, **kwargs):
    """Update call context with new values"""
    if not call_sid:
        return
    ctx = call_context_cache.get(call_sid, {})
    ctx.update(kwargs)
    call_context_cache[call_sid] = ctx
    logger.debug(f"Updated call context for {call_sid}: {ctx}")

@router.post("/voice/incoming")
async def voice_incoming(
    request: Request,
    To: Optional[str] = Form(None),
    From: Optional[str] = Form(None),
    CallSid: Optional[str] = Form(None)
):
    """Handle incoming call - returns main menu or off-mode TwiML"""
    from datetime import datetime
    
    # Track call statistics
    request.app.state.last_call_at = datetime.utcnow()
    request.app.state.call_count = getattr(request.app.state, 'call_count', 0) + 1
    
    tenant_id = sheet_service.resolve_tenant_by_phone(To)
    logger.info(f"Incoming call for {tenant_id} from {From} (CallSid: {CallSid})")
    
    config = sheet_service.get_tenant_config(tenant_id)
    is_open = sheet_service.is_store_open(config)
    
    # Store initial call context
    _update_call_context(CallSid, 
        tenant_id=tenant_id,
        from_number=From,
        to_number=To,
        is_open=is_open,
        menu_selection="off" if not is_open else None
    )
    
    xml = voice_service.generate_incoming_response(config, is_open)
    return Response(content=xml, media_type="application/xml")

@router.post("/voice/menu")
async def voice_menu(
    Digits: str = Form(...),
    To: Optional[str] = Form(None),
    CallSid: Optional[str] = Form(None)
):
    """Handle menu digit selection (1=repair, 2=accessory, 3=hours)"""
    tenant_id = sheet_service.resolve_tenant_by_phone(To)
    config = sheet_service.get_tenant_config(tenant_id)
    
    # Map digit to menu name
    menu_map = {"1": "repair", "2": "accessory", "3": "hours"}
    menu_name = menu_map.get(Digits, f"invalid({Digits})")
    
    # Store menu selection in call context
    _update_call_context(CallSid, menu_selection=menu_name, digit=Digits)
    logger.info(f"Menu selection: {menu_name} for CallSid: {CallSid}")
    
    xml = voice_service.generate_menu_response(config, Digits)
    return Response(content=xml, media_type="application/xml")

@router.post("/voice/no-input")
async def voice_no_input(
    To: Optional[str] = Form(None),
    CallSid: Optional[str] = Form(None)
):
    """Handle no input timeout"""
    tenant_id = sheet_service.resolve_tenant_by_phone(To)
    config = sheet_service.get_tenant_config(tenant_id)
    
    _update_call_context(CallSid, menu_selection="no-input")
    
    xml = voice_service.generate_no_input_response(config)
    return Response(content=xml, media_type="application/xml")

@router.post("/voice/recorded-thank-you")
async def voice_recorded_thank_you(
    To: Optional[str] = Form(None),
    CallSid: Optional[str] = Form(None)
):
    """Thank you message after recording"""
    tenant_id = sheet_service.resolve_tenant_by_phone(To)
    config = sheet_service.get_tenant_config(tenant_id)
    xml = voice_service.generate_thank_you_response(config)
    return Response(content=xml, media_type="application/xml")

@router.post("/voice/recording-status")
async def recording_status(
    background_tasks: BackgroundTasks,
    RecordingUrl: str = Form(...),
    RecordingDuration: Optional[str] = Form(None),
    From: Optional[str] = Form(None),
    To: Optional[str] = Form(None),
    CallSid: Optional[str] = Form(None)
):
    """Callback when recording is complete - triggers email report"""
    logger.info(f"Recording received: {RecordingUrl} duration={RecordingDuration}")
    
    tenant_id = sheet_service.resolve_tenant_by_phone(To)
    
    # Get call context for menu selection
    call_ctx = _get_call_context(CallSid)
    menu_selection = call_ctx.get("menu_selection", "unknown")
    
    background_tasks.add_task(
        processing_service.process_recording, 
        tenant_id=tenant_id,
        recording_url=RecordingUrl, 
        from_number=From, 
        call_sid=CallSid, 
        duration=RecordingDuration,
        menu_selection=menu_selection
    )
    
    return Response(status_code=200)

@router.post("/voice/call-status")
async def call_status(
    CallSid: Optional[str] = Form(None),
    CallStatus: Optional[str] = Form(None),
    CallDuration: Optional[str] = Form(None),
    To: Optional[str] = Form(None),
    From: Optional[str] = Form(None)
):
    """Optional: Receive call status updates from Twilio"""
    logger.info(f"Call status: {CallStatus} duration={CallDuration} for {CallSid}")
    
    _update_call_context(CallSid, 
        call_status=CallStatus,
        call_duration=CallDuration
    )
    
    return Response(status_code=200)
