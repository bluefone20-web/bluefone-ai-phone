from app.services import sheet_service, ai_service, email_service
from app.core.config import settings
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
    1. Download and transcribe audio (OpenAI Whisper)
    2. Generate summary (GPT)
    3. Send email with recording link + transcript + summary
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
    
    # 3. Transcribe audio (if OpenAI API key is configured)
    transcript = "Transcription not available"
    summary = "Summary not available"
    
    if settings.OPENAI_API_KEY:
        logger.info(f"Starting transcription for {call_sid}...")
        try:
            transcript = ai_service.transcribe_audio_from_url(recording_url)
            logger.info(f"Transcription complete: {len(transcript)} chars")
            
            # Generate summary if transcript is valid
            if transcript and not transcript.startswith("Error"):
                logger.info(f"Generating summary for {call_sid}...")
                summary = ai_service.generate_summary(transcript)
                logger.info(f"Summary complete")
        except Exception as e:
            logger.error(f"AI processing error: {e}")
            transcript = f"Transcription error: {e}"
            summary = "Summary not available due to transcription error"
    else:
        logger.warning("OPENAI_API_KEY not configured - skipping transcription")
        transcript = "Transcription not available (API key not configured)"
        summary = "Summary not available (API key not configured)"
    
    # 4. Format Subject: "{store_name} Call | Menu {digitOrOff} | {From} | recording"
    subject = f"{store_name} Call | Menu {menu_selection} | {from_number} | recording"
    
    # 5. Build email body with transcript and summary
    body = f"""New voicemail recording received.

========================================
CALL DETAILS
========================================
Store: {store_name}
From: {from_number}
Time: {timestamp} ({timezone_str})
Menu: {menu_selection}
Duration: {duration}s
Call SID: {call_sid}

========================================
SUMMARY
========================================
{summary}

========================================
TRANSCRIPT
========================================
{transcript}

========================================
RECORDING
========================================
{recording_url}
"""
    
    # 6. Send Email
    email_service.send_report(recipients, subject, body)
    logger.info(f"Email sent for CallSid={call_sid}")
