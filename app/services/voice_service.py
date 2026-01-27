from twilio.twiml.voice_response import VoiceResponse
import logging

logger = logging.getLogger(__name__)

def _get_prompt(config, key, context=None):
    """Helper to get and format prompt"""
    prompts = config.get("prompts", {})
    text = prompts.get(key, "")
    if context and text:
        try:
            return text.format(**context)
        except Exception as e:
            logger.error(f"Error formatting prompt {key}: {e}")
            return text
    return text

def _build_context(config):
    """Merges settings and repair_scope for formatting"""
    ctx = {}
    ctx.update(config.get("settings", {}))
    ctx.update(config.get("repair_scope", {}))
    # Add calculated fields if needed
    ctx["STORE_NAME"] = ctx.get("store_name", "")
    ctx["ADDRESS_LINE"] = ctx.get("address_line", "")
    
    # Upper case keys for matching the template style {STORE_NAME}
    # Create a copy with upper keys
    upper_ctx = {k.upper(): v for k, v in ctx.items()}
    # Also keep original keys just in case
    return {**ctx, **upper_ctx}

def generate_incoming_response(config, is_open):
    resp = VoiceResponse()
    ctx = _build_context(config)
    
    if not is_open:
        # Off Mode
        off_mode = config.get("settings", {}).get("off_mode", "voicemail")
        if off_mode == "voicemail":
            prompt = _get_prompt(config, "off_voicemail_prompt", ctx)
            resp.say(prompt, voice="alice")
            resp.record(max_length=60, timeout=5, play_beep=True, trim="trim-silence",
                        recording_status_callback="/voice/recording-status",
                        recording_status_callback_method="POST",
                        action="/voice/recorded-thank-you" 
                       )
        else:
            # Hangup mode
            prompt = _get_prompt(config, "off_hangup_prompt", ctx)
            resp.say(prompt, voice="alice")
            resp.hangup()
        return str(resp)

    # Main Menu (Open)
    prompt_intro = _get_prompt(config, "main_intro", ctx)
    prompt_scope = _get_prompt(config, "main_scope", ctx)
    prompt_menu = _get_prompt(config, "menu_prompt", ctx)
    
    full_intro = f"{prompt_intro} {prompt_scope}"
    
    resp.say(full_intro, voice="alice")
    gather = resp.gather(num_digits=1, timeout=6, action="/voice/menu", method="POST")
    gather.say(prompt_menu, voice="alice")
    
    # No Input redirect
    resp.redirect("/voice/no-input")
    return str(resp)

def generate_menu_response(config, digit):
    resp = VoiceResponse()
    ctx = _build_context(config)
    
    if digit == "1": # Repairs
        prompt = _get_prompt(config, "repair_prompt", ctx)
        resp.say(prompt, voice="alice")
        resp.record(max_length=120, timeout=5, play_beep=True, trim="trim-silence",
                    recording_status_callback="/voice/recording-status",
                    recording_status_callback_method="POST",
                    action="/voice/recorded-thank-you")
                    
    elif digit == "2": # Accessories
        prompt = _get_prompt(config, "accessory_prompt", ctx)
        resp.say(prompt, voice="alice")
        resp.record(max_length=90, timeout=5, play_beep=True, trim="trim-silence",
                    recording_status_callback="/voice/recording-status",
                    recording_status_callback_method="POST",
                    action="/voice/recorded-thank-you")
                    
    elif digit == "3": # Hours
        # Add hours to context specifically
        ctx['HOURS'] = config.get("settings", {}).get("hours_text", "")
        prompt = _get_prompt(config, "hours_prompt", ctx)
        resp.say(prompt, voice="alice")
        resp.hangup()
        
    else: # Invalid
        prompt = _get_prompt(config, "invalid_prompt", ctx)
        resp.say(prompt, voice="alice")
        resp.hangup()
        
    return str(resp)

def generate_no_input_response(config):
    resp = VoiceResponse()
    ctx = _build_context(config)
    prompt = _get_prompt(config, "no_input_prompt", ctx)
    resp.say(prompt, voice="alice")
    resp.hangup()
    return str(resp)

def generate_thank_you_response(config=None):
    # Support optional config for dynamic prompt
    text = "Thank you. We will review your message and call you back."
    if config:
        text = _get_prompt(config, "after_record_thanks") or text
        
    resp = VoiceResponse()
    resp.say(text, voice="alice")
    resp.hangup()
    return str(resp)
