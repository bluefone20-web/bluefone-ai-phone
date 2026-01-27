import gspread
from oauth2client.service_account import ServiceAccountCredentials
from app.core.config import settings
from cachetools import TTLCache, cached
import csv
import os
import json
from datetime import datetime
import pytz
import logging

logger = logging.getLogger(__name__)

# Cache configuration (180s TTL)
msg_cache = TTLCache(maxsize=100, ttl=settings.SHEET_CACHE_TTL)

# Tenant Mapping: phone_number -> spreadsheet_id
# In production, this could come from a master sheet or database
TENANT_MAP = {
    "bluefone_cannonhill": os.environ.get("SHEET_ID_CANNONHILL", "SPREADSHEET_ID_PLACEHOLDER")
}

# Phone number to tenant_id mapping
PHONE_TO_TENANT = {
    # Add your Twilio numbers here: "+61XXXXXXXXX": "bluefone_cannonhill"
}

def get_gspread_client():
    """Get authenticated gspread client, supports both file and JSON string credentials"""
    if settings.MOCK_MODE:
        return None
    
    scope = ['https://spreadsheets.google.com/feeds', 'https://www.googleapis.com/auth/drive']
    
    # Priority: JSON string env var > credentials file
    if settings.GOOGLE_SERVICE_ACCOUNT_JSON:
        try:
            creds_dict = json.loads(settings.GOOGLE_SERVICE_ACCOUNT_JSON)
            creds = ServiceAccountCredentials.from_json_keyfile_dict(creds_dict, scope)
            logger.info("Using GOOGLE_SERVICE_ACCOUNT_JSON for authentication")
        except json.JSONDecodeError as e:
            logger.error(f"Invalid GOOGLE_SERVICE_ACCOUNT_JSON: {e}")
            raise
    elif os.path.exists(settings.GOOGLE_CREDENTIALS_FILE):
        creds = ServiceAccountCredentials.from_json_keyfile_name(settings.GOOGLE_CREDENTIALS_FILE, scope)
        logger.info(f"Using credentials file: {settings.GOOGLE_CREDENTIALS_FILE}")
    else:
        logger.error("No Google credentials available")
        return None
    
    client = gspread.authorize(creds)
    return client

def resolve_tenant_by_phone(to_number: str) -> str:
    """Resolve tenant_id from incoming phone number"""
    # Clean the number
    clean_number = to_number.strip() if to_number else ""
    
    # Check mapping
    tenant_id = PHONE_TO_TENANT.get(clean_number)
    if tenant_id:
        return tenant_id
    
    # Default fallback
    logger.warning(f"No tenant mapping for {clean_number}, using default")
    return "bluefone_cannonhill"

@cached(msg_cache)
def get_tenant_config(tenant_id: str):
    """
    Fetches and consolidates settings from Google Sheets or CSV templates (Mock).
    Returns a dict with: settings, schedule, prompts, repair_scope
    """
    if settings.MOCK_MODE:
        return _fetch_from_csv()
    
    # Real Sheet logic
    client = get_gspread_client()
    spreadsheet_id = TENANT_MAP.get(tenant_id)
    if not spreadsheet_id:
        # Fallback or error
        logger.error(f"No spreadsheet found for {tenant_id}")
        return _fetch_from_csv() # Fallback to mock/default

    try:
        sheet = client.open_by_key(spreadsheet_id)
        
        # Load all 4 worksheets
        ws_settings = sheet.worksheet("settings").get_all_records()
        ws_schedule = sheet.worksheet("schedule").get_all_records()
        ws_prompts = sheet.worksheet("prompts").get_all_records()
        ws_repair = sheet.worksheet("repair_scope").get_all_records()
        
        return _normalize_config(ws_settings, ws_schedule, ws_prompts, ws_repair)
        
    except Exception as e:
        logger.error(f"Error fetching sheets: {e}")
        # Fallback to defaults?
        return _fetch_from_csv()

def _fetch_from_csv():
    """Reads from local CSV templates for mocking"""
    base_path = "sheet_templates"
    
    def read_csv(name):
        path = os.path.join(base_path, f"{name}.csv")
        if not os.path.exists(path):
            return []
        with open(path, 'r', encoding='utf-8') as f:
            return list(csv.DictReader(f))
            
    return _normalize_config(
        read_csv("settings"),
        read_csv("schedule"),
        read_csv("prompts"),
        read_csv("repair_scope")
    )

def _normalize_config(settings_rows, schedule_rows, prompts_rows, repair_rows):
    """Converts list of dicts to usable dictionaries"""
    
    # 1. Settings (Key-Value)
    config = {}
    for row in settings_rows:
        config[row.get('key')] = row.get('value')
        
    # 2. Schedule (List)
    schedule = schedule_rows # Keep as list
    
    # 3. Prompts (Key-Text)
    prompts = {}
    for row in prompts_rows:
        prompts[row.get('key')] = row.get('text')
        
    # 4. Repair Scope (Key-Value)
    repair = {}
    for row in repair_rows:
        repair[row.get('key')] = row.get('value')
        
    return {
        "settings": config,
        "schedule": schedule,
        "prompts": prompts,
        "repair_scope": repair
    }

def is_store_open(config: dict, current_dt: datetime = None) -> bool:
    """
    Determines if store is open based on config.
    Logic:
    1. if manual_mode=TRUE -> use manual_enabled
    2. else -> check schedule vs current_dt (in tenant timezone)
    """
    c_settings = config.get("settings", {})
    
    # Check Manual Mode
    manual_mode = str(c_settings.get("manual_mode", "FALSE")).upper() == "TRUE"
    manual_enabled = str(c_settings.get("manual_enabled", "TRUE")).upper() == "TRUE"
    default_enabled = str(c_settings.get("default_enabled", "TRUE")).upper() == "TRUE"
    
    if manual_mode:
        return manual_enabled
        
    # Check Schedule
    tz_name = c_settings.get("timezone", "Australia/Brisbane")
    try:
        tz = pytz.timezone(tz_name)
    except:
        tz = pytz.UTC
        
    if not current_dt:
        current_dt = datetime.now(tz)
    else:
        # Ensure current_dt has tz
        if current_dt.tzinfo is None:
            current_dt = current_dt.replace(tzinfo=tz)
            
    # Parse Schedule
    # Day mapping: Mon=0, Sun=6? Python weekday: Mon=0, Sun=6
    # CSV Day: Mon, Tue...
    current_day_str = current_dt.strftime("%a") # Mon, Tue
    
    schedule = config.get("schedule", [])
    today_rule = next((row for row in schedule if row.get("day") == current_day_str), None)
    
    if not today_rule:
        return default_enabled # No rule found for today
        
    # Check enabled flag for day
    day_enabled = str(today_rule.get("enabled", "TRUE")).upper() == "TRUE"
    if not day_enabled:
        return False
        
    # Check Time Range
    start_str = today_rule.get("start", "00:00")
    end_str = today_rule.get("end", "23:59")
    
    try:
        # Create time objects
        current_time = current_dt.time()
        start_time = datetime.strptime(start_str, "%H:%M").time()
        end_time = datetime.strptime(end_str, "%H:%M").time()
        
        if start_time <= current_time <= end_time:
            return True
        return False
    except Exception as e:
        logger.error(f"Error parsing time: {e}")
        return default_enabled

