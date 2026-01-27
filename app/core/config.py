import os
from pydantic_settings import BaseSettings
from typing import Optional

class Settings(BaseSettings):
    PROJECT_NAME: str = "Bluefone IVR"
    
    # Google Sheets - support both file path and JSON string (for Render/Railway)
    GOOGLE_CREDENTIALS_FILE: str = "credentials.json"
    GOOGLE_SERVICE_ACCOUNT_JSON: Optional[str] = None  # JSON string from env var
    
    SHEET_CACHE_TTL: int = 180  # 3 minutes cache
    MOCK_MODE: bool = True  # Default to True for immediate testing without creds
    
    # Transcription / AI
    OPENAI_API_KEY: str = ""
    
    # Twilio
    TWILIO_ACCOUNT_SID: str = ""
    TWILIO_AUTH_TOKEN: str = ""
    TWILIO_PHONE_NUMBER: str = ""
    
    # Email - SendGrid
    SENDGRID_API_KEY: str = ""
    EMAIL_FROM: str = "noreply@bluefone.com"
    
    # Base URL for webhooks (used in recording callbacks)
    BASE_URL: str = ""
    
    class Config:
        env_file = ".env"

settings = Settings()
