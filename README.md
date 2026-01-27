# Bluefone IVR System

A multi-tenant IVR system for small businesses, powered by Twilio, Google Sheets, and OpenAI.

## Features
- **Smart IVR**: Handles calls based on store hours and manual override
- **Google Sheets Config**: Manage settings, hours, and prompts directly in Sheets
- **ON/OFF Logic**: Manual mode + schedule-based auto on/off
- **Email Reports**: Recording links sent immediately via SendGrid
- **AI-Powered**: Auto-transcription and summarization of voicemails (coming soon)

## Webhooks

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check for deployment |
| `/voice/incoming` | POST | Main entry - returns menu or off-mode TwiML |
| `/voice/menu` | POST | Handle digit selection (1/2/3) |
| `/voice/no-input` | POST | Handle timeout |
| `/voice/recording-status` | POST | Callback when recording complete |
| `/voice/call-status` | POST | Optional call status updates |

## Local Development

1. **Install Dependencies**
   ```bash
   pip install -r requirements.txt
   ```

2. **Configuration**
   ```bash
   cp .env.example .env
   # Edit .env with your values
   ```

3. **Run Server**
   ```bash
   uvicorn app.main:app --reload --port 8000
   ```

4. **Test with ngrok** (for Twilio webhooks)
   ```bash
   ngrok http 8000
   ```

## Deploy to Render

1. **Push to GitHub**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/YOUR_USER/bluefone-ivr.git
   git push -u origin main
   ```

2. **Create Render Web Service**
   - Connect your GitHub repo
   - Runtime: Python
   - Build Command: `pip install -r requirements.txt`
   - Start Command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
   - Health Check Path: `/health`

3. **Set Environment Variables** (in Render Dashboard)
   ```
   MOCK_MODE=FALSE
   GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
   SHEET_ID_CANNONHILL=your_spreadsheet_id
   TWILIO_ACCOUNT_SID=ACxxxxxxx
   TWILIO_AUTH_TOKEN=xxxxxxx
   SENDGRID_API_KEY=SG.xxxxxxx
   EMAIL_FROM=noreply@yourdomain.com
   OPENAI_API_KEY=sk-xxxxxxx
   ```

4. **Configure Twilio**
   - Go to Twilio Console > Phone Numbers
   - Set Voice Webhook URL: `https://your-app.onrender.com/voice/incoming`
   - Method: POST

## Google Sheets Setup

Create a spreadsheet with these worksheets:
- **settings**: key, value, note
- **schedule**: day, start, end, enabled
- **prompts**: key, text
- **repair_scope**: key, value

Share the spreadsheet with your service account email.

## Test Plan

1. **Health Check**
   ```bash
   curl https://your-app.onrender.com/health
   # Expected: {"status":"healthy","service":"bluefone-ivr"}
   ```

2. **Mock Incoming Call** (local)
   ```bash
   curl -X POST http://localhost:8000/voice/incoming \
     -d "To=+61400000000&From=+61400000001&CallSid=CA123"
   # Expected: TwiML with <Gather> menu
   ```

3. **Test Menu Selection**
   ```bash
   curl -X POST http://localhost:8000/voice/menu \
     -d "Digits=1&To=+61400000000&CallSid=CA123"
   # Expected: TwiML with repair prompt + <Record>
   ```

4. **Real Call Test**
   - Call your Twilio number
   - Verify IVR menu plays
   - Press 1, leave voicemail
   - Check email received with recording link
