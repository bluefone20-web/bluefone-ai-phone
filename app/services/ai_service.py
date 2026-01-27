import openai
from app.core.config import settings
import logging
import requests
import os

logger = logging.getLogger(__name__)

# Lazy client initialization (avoids error if API key not set at import time)
_client = None

def _get_client():
    global _client
    if _client is None and settings.OPENAI_API_KEY:
        _client = openai.OpenAI(api_key=settings.OPENAI_API_KEY)
    return _client

def transcribe_audio_from_url(url: str, save_path: str = "temp_recording.wav") -> str:
    if not settings.OPENAI_API_KEY:
        return "Transcription unavailable (No API Key)"
    
    client = _get_client()
    if not client:
        return "Transcription unavailable (Client initialization failed)"
        
    try:
        # 1. Download File
        # Handle Twilio Auth if needed (using requests.get(url, auth=(sid, token)))
        # For MVP assuming public URL or add auth if fails
        if settings.TWILIO_ACCOUNT_SID and settings.TWILIO_AUTH_TOKEN:
            resp = requests.get(url, auth=(settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN))
        else:
            resp = requests.get(url)
            
        if resp.status_code != 200:
            logger.error(f"Failed to download audio: {resp.status_code}")
            return f"Error downloading audio: {resp.status_code}"
            
        with open(save_path, "wb") as f:
            f.write(resp.content)
            
        # 2. Transcribe
        with open(save_path, "rb") as audio_file:
            transcript = _get_client().audio.transcriptions.create(
                model="whisper-1", 
                file=audio_file,
                language="en" # Force English as per spec
            )
            
        # Cleanup
        if os.path.exists(save_path):
            os.remove(save_path)
            
        return transcript.text
        
    except Exception as e:
        logger.error(f"Transcription error: {e}")
        return f"Error during transcription: {e}"

def generate_summary(text: str) -> str:
    if not settings.OPENAI_API_KEY:
        return "Summary unavailable (No API Key)"
    
    client = _get_client()
    if not client:
        return "Summary unavailable (Client initialization failed)"
        
    try:
        response = client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[
                {"role": "system", "content": "You are a helpful assistant for a phone repair shop. Summarize the following customer inquiry concisely in English. Include: device type, issue, and any specific requests."},
                {"role": "user", "content": text}
            ]
        )
        return response.choices[0].message.content
    except Exception as e:
        logger.error(f"Summary error: {e}")
        return f"Error generating summary: {e}"
