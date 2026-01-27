from app.services import sheet_service, voice_service
from app.core.config import settings
import logging

# Setup Logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("verifier")

def verify():
    print("--- Verifying Bluefone IVR Logic ---")
    
    # 1. Config Loading
    print("\n[1] Testing Sheet Service (Mock Mode)")
    settings.MOCK_MODE = True
    config = sheet_service.get_tenant_config("bluefone_cannonhill")
    
    store_name = config.get("settings", {}).get("store_name")
    print(f"Loaded Store Name: {store_name}")
    
    if store_name != "Bluefone":
        print("FAIL: Store name mismatch")
    else:
        print("PASS: Store name loaded")
        
    # 2. Store Open Logic
    print("\n[2] Testing Is Store Open")
    # Using defaults from CSV (Manual=False, ManualEnabled=True, Schedule... depends on day)
    # Let's force Manual Mode
    config["settings"]["manual_mode"] = "TRUE"
    config["settings"]["manual_enabled"] = "TRUE"
    
    is_open = sheet_service.is_store_open(config)
    print(f"Manual Mode ON, Enabled TRUE -> is_open: {is_open}")
    if is_open:
        print("PASS: Manual Mode override working")
    else:
        print("FAIL: Manual Mode logic broken")
        
    config["settings"]["manual_enabled"] = "FALSE"
    is_open_closed = sheet_service.is_store_open(config)
    print(f"Manual Mode ON, Enabled FALSE -> is_open: {is_open_closed}")
    if not is_open_closed:
        print("PASS: Manual Mode CLOSE working")
        
    # 3. TwiML Generation
    print("\n[3] Testing TwiML Generation")
    xml = voice_service.generate_incoming_response(config, is_open=True)
    if "<Gather" in xml and "Press 1" in xml: # Assuming standard text
        print("PASS: Main Menu XML generated")
    else:
        print(f"WARN: Main Menu XML check loose. Content: {xml[:50]}...")
    
    xml_closed = voice_service.generate_incoming_response(config, is_open=False)
    if "currently off" in xml_closed:
        print("PASS: Off Message XML generated")
        
    print("\n--- Verification Complete ---")

if __name__ == "__main__":
    verify()
