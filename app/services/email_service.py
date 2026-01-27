import logging
from app.core.config import settings

logger = logging.getLogger(__name__)

def send_report(recipients: list, subject: str, body: str):
    """
    Sends email report via SendGrid.
    Falls back to logging if SendGrid is not configured.
    """
    if not recipients:
        logger.warning("No email recipients defined.")
        return

    logger.info(f"Preparing email to {recipients} | Subject: {subject}")
    
    # Use SendGrid if API key is configured
    if settings.SENDGRID_API_KEY:
        _send_via_sendgrid(recipients, subject, body)
    else:
        # Fallback: Log to file for dev/testing
        _log_email_to_file(recipients, subject, body)

def _send_via_sendgrid(recipients: list, subject: str, body: str):
    """Send email using SendGrid API"""
    try:
        from sendgrid import SendGridAPIClient
        from sendgrid.helpers.mail import Mail, Email, To, Content
        
        sg = SendGridAPIClient(api_key=settings.SENDGRID_API_KEY)
        
        # Build message
        from_email = Email(settings.EMAIL_FROM)
        to_emails = [To(r) for r in recipients]
        content = Content("text/plain", body)
        
        message = Mail(
            from_email=from_email,
            to_emails=to_emails,
            subject=subject,
            plain_text_content=content
        )
        
        response = sg.send(message)
        logger.info(f"SendGrid response: {response.status_code}")
        
        if response.status_code >= 400:
            logger.error(f"SendGrid error: {response.body}")
            # Fallback to log
            _log_email_to_file(recipients, subject, body)
            
    except Exception as e:
        logger.error(f"SendGrid error: {e}")
        # Fallback to log on error
        _log_email_to_file(recipients, subject, body)

def _log_email_to_file(recipients: list, subject: str, body: str):
    """Fallback: Log email to file for dev/testing"""
    try:
        with open("emails.log", "a", encoding="utf-8") as f:
            f.write(f"\n{'='*50}\n")
            f.write(f"TO: {', '.join(recipients)}\n")
            f.write(f"SUBJECT: {subject}\n")
            f.write(f"BODY:\n{body}\n")
            f.write(f"{'='*50}\n")
        logger.info("Email written to emails.log (SendGrid not configured)")
    except Exception as e:
        logger.error(f"Failed to log email: {e}")
