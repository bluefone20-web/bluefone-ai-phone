from app.services import sheet_service, ai_service, email_service
from datetime import datetime
import pytz
import logging

logger = logging.getLogger(__name__)

async def process_recording(
    tenant_id: str, 
    recording_url: str, 
    from_number: str, 
    call_sid: str, 
    duration: str = "N/A",
    menu_selection: str = "unknown"
):
    """
    Process a completed recording:
    1. Send immediate email with recording link
    2. (Future) Add transcription and summary
    """
    logger.info(f"Processing recording for {tenant_id}, menu={menu_selection}...")
    
    # 1. Get Config
    config = sheet_service.get_tenant_config(tenant_id)
    cfg_settings = config.get("settings", {})
    store_name = cfg_settings.get("store_name", "Store")
    timezone_str = cfg_settings.get("timezone", "UTC")
    recipients_str = cfg_settings.get("email_recipients", "")
    recipients = [r.strip() for r in recipients_str.split(",") if r.strip()]
    
    if not recipients:
        logger.error("No email recipients found for tenant")
        return

    # 2. Get timestamp in tenant timezone
    try:
        tz = pytz.timezone(timezone_str)
    except:
        tz = pytz.UTC
    
    timestamp = datetime.now(tz).strftime("%Y-%m-%d %H:%M:%S")
    
    # 3. Format Subject: "{store_name} Call | Menu {digitOrOff} | {From} | recording"
    subject = f"{store_name} Call | Menu {menu_selection} | {from_number} | recording"
    
    # 4. Build body (MVP: recording link only, transcript/summary later)
    body = f"""New voicemail recording received.

Store: {store_name}
From: {from_number}
Time: {timestamp} ({timezone_str})
Menu: {menu_selection}
Duration: {duration}s
Call SID: {call_sid}

Recording URL:
{recording_url}

---
(Transcription and summary will be added in next version)
"""
    
    # 5. Send Email
    email_service.send_report(recipients, subject, body)
    logger.info(f"Email sent for CallSid={call_sid}")
