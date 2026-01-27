#!/usr/bin/env python3
"""
Bluefone IVR Watchdog Script
Run via cron every 5 minutes to monitor server health.

Usage:
    python watchdog.py [--slack-webhook URL] [--email EMAIL]
    
Cron example:
    */5 * * * * /home/ubuntu/venv/bin/python /home/ubuntu/bluefone-ai-phone/scripts/watchdog.py
"""

import sys
import os
import json
import argparse
import subprocess
from datetime import datetime
from urllib.request import urlopen, Request
from urllib.error import URLError, HTTPError

# Configuration
SERVER_URL = os.environ.get("WATCHDOG_SERVER_URL", "http://localhost:8000")
HEALTH_ENDPOINT = f"{SERVER_URL}/health"
STATUS_ENDPOINT = f"{SERVER_URL}/internal/status"
WARMUP_ENDPOINT = f"{SERVER_URL}/internal/warmup"

SERVICE_NAME = "bluefone-ivr"
LOG_FILE = "/var/log/bluefone-watchdog.log"

def log(message: str, level: str = "INFO"):
    """Log message to stdout and optionally to file"""
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{timestamp}] [{level}] {message}"
    print(line)
    
    # Try to write to log file
    try:
        with open(LOG_FILE, "a") as f:
            f.write(line + "\n")
    except:
        pass  # Ignore if can't write to log

def check_health() -> tuple[bool, str]:
    """Check server health endpoint"""
    try:
        with urlopen(HEALTH_ENDPOINT, timeout=10) as response:
            data = json.loads(response.read().decode())
            if data.get("status") == "healthy":
                return True, "Server healthy"
            return False, f"Unhealthy status: {data}"
    except HTTPError as e:
        return False, f"HTTP error: {e.code}"
    except URLError as e:
        return False, f"Connection failed: {e.reason}"
    except Exception as e:
        return False, f"Error: {str(e)}"

def get_status() -> dict:
    """Get detailed server status"""
    try:
        with urlopen(STATUS_ENDPOINT, timeout=10) as response:
            return json.loads(response.read().decode())
    except:
        return {}

def trigger_warmup() -> bool:
    """Trigger cache warmup"""
    try:
        req = Request(WARMUP_ENDPOINT, method="POST")
        with urlopen(req, timeout=30) as response:
            data = json.loads(response.read().decode())
            return data.get("status") in ["ok", "partial"]
    except:
        return False

def restart_service():
    """Attempt to restart the service via systemd"""
    log("Attempting to restart service...", "WARN")
    try:
        result = subprocess.run(
            ["sudo", "systemctl", "restart", SERVICE_NAME],
            capture_output=True,
            timeout=30
        )
        if result.returncode == 0:
            log("Service restarted successfully", "INFO")
            return True
        else:
            log(f"Failed to restart: {result.stderr.decode()}", "ERROR")
            return False
    except Exception as e:
        log(f"Restart failed: {e}", "ERROR")
        return False

def send_slack_alert(webhook_url: str, message: str, is_error: bool = True):
    """Send alert to Slack"""
    if not webhook_url:
        return
    
    emoji = "🚨" if is_error else "✅"
    payload = {
        "text": f"{emoji} *Bluefone IVR Alert*\n{message}",
        "username": "Bluefone Watchdog"
    }
    
    try:
        req = Request(
            webhook_url,
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        with urlopen(req, timeout=10):
            log("Slack alert sent", "INFO")
    except Exception as e:
        log(f"Failed to send Slack alert: {e}", "WARN")

def send_email_alert(email: str, subject: str, body: str):
    """Send alert via email (using local mail command)"""
    if not email:
        return
    
    try:
        subprocess.run(
            ["mail", "-s", subject, email],
            input=body.encode(),
            timeout=10
        )
        log(f"Email alert sent to {email}", "INFO")
    except Exception as e:
        log(f"Failed to send email alert: {e}", "WARN")

def main():
    parser = argparse.ArgumentParser(description="Bluefone IVR Watchdog")
    parser.add_argument("--slack-webhook", help="Slack webhook URL for alerts")
    parser.add_argument("--email", help="Email address for alerts")
    parser.add_argument("--warmup", action="store_true", help="Also trigger cache warmup")
    parser.add_argument("--restart", action="store_true", help="Auto-restart on failure")
    parser.add_argument("--verbose", "-v", action="store_true", help="Verbose output")
    args = parser.parse_args()
    
    log("Starting health check...", "INFO")
    
    # Check health
    healthy, message = check_health()
    
    if healthy:
        log(message, "INFO")
        
        # Optionally get detailed status
        if args.verbose:
            status = get_status()
            if status:
                uptime = status.get("uptime", {}).get("human", "unknown")
                calls = status.get("calls", {}).get("total", 0)
                log(f"Uptime: {uptime}, Total calls: {calls}", "INFO")
        
        # Optionally warmup cache
        if args.warmup:
            if trigger_warmup():
                log("Cache warmup triggered", "INFO")
            else:
                log("Cache warmup failed", "WARN")
        
        sys.exit(0)
    else:
        log(f"UNHEALTHY: {message}", "ERROR")
        
        # Send alerts
        alert_msg = f"Server check failed: {message}\nTime: {datetime.now().isoformat()}"
        
        if args.slack_webhook:
            send_slack_alert(args.slack_webhook, alert_msg, is_error=True)
        
        if args.email:
            send_email_alert(
                args.email,
                "🚨 Bluefone IVR Server Down",
                alert_msg
            )
        
        # Attempt restart if requested
        if args.restart:
            if restart_service():
                # Wait and check again
                import time
                time.sleep(5)
                healthy2, message2 = check_health()
                if healthy2:
                    log("Service recovered after restart", "INFO")
                    if args.slack_webhook:
                        send_slack_alert(args.slack_webhook, "✅ Service recovered after restart", is_error=False)
                    sys.exit(0)
                else:
                    log(f"Service still unhealthy after restart: {message2}", "ERROR")
        
        sys.exit(1)

if __name__ == "__main__":
    main()
