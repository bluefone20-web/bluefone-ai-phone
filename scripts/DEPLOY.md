# Bluefone IVR - Self-Hosted Deployment Guide

자체 서버(VPS/EC2/Lightsail) 배포 가이드.

## Prerequisites

- Ubuntu 20.04+ (또는 Debian-based)
- Python 3.10+
- 공인 IP 또는 도메인
- Twilio 계정
- Google Sheets API credentials

---

## 1. 서버 초기 설정

```bash
# 업데이트
sudo apt update && sudo apt upgrade -y

# Python 설치
sudo apt install python3.10 python3.10-venv python3-pip git -y

# 프로젝트 클론
cd /home/ubuntu
git clone https://github.com/bluefone20-web/bluefone-ai-phone.git
cd bluefone-ai-phone

# 가상환경 생성
python3.10 -m venv /home/ubuntu/venv
source /home/ubuntu/venv/bin/activate

# 의존성 설치
pip install -r requirements.txt
```

---

## 2. 환경변수 설정

```bash
cp .env.example .env
nano .env
```

필수 설정:
```env
MOCK_MODE=FALSE
GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account",...전체 JSON...}
SHEET_ID_CANNONHILL=your_spreadsheet_id
TWILIO_ACCOUNT_SID=ACxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxx
SENDGRID_API_KEY=SG.xxxxxxxxxx
EMAIL_FROM=noreply@yourdomain.com
```

---

## 3. systemd 서비스 설정

```bash
# 서비스 파일 복사
sudo cp scripts/bluefone-ivr.service /etc/systemd/system/

# 경로 수정 (필요시)
sudo nano /etc/systemd/system/bluefone-ivr.service

# 서비스 활성화
sudo systemctl daemon-reload
sudo systemctl enable bluefone-ivr
sudo systemctl start bluefone-ivr

# 상태 확인
sudo systemctl status bluefone-ivr

# 로그 확인
journalctl -u bluefone-ivr -f
```

---

## 4. 헬스체크 테스트

```bash
# 기본 헬스체크
curl http://localhost:8000/health
# {"status":"healthy","service":"bluefone-ivr"}

# 상세 상태
curl http://localhost:8000/internal/status

# 캐시 워밍
curl -X POST http://localhost:8000/internal/warmup
```

---

## 5. Cron 설정

```bash
# crontab 편집
crontab -e

# 아래 추가:
# 5분마다 헬스체크 + 자동 재시작
*/5 * * * * curl -sf http://localhost:8000/health || sudo systemctl restart bluefone-ivr

# 10분마다 캐시 워밍
*/10 * * * * curl -sf -X POST http://localhost:8000/internal/warmup
```

---

## 6. Nginx + HTTPS (선택사항, 권장)

```bash
# Nginx 설치
sudo apt install nginx certbot python3-certbot-nginx -y

# Nginx 설정
sudo nano /etc/nginx/sites-available/bluefone-ivr
```

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
# 활성화
sudo ln -s /etc/nginx/sites-available/bluefone-ivr /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx

# SSL 인증서 (Let's Encrypt)
sudo certbot --nginx -d your-domain.com
```

---

## 7. Twilio Webhook 설정

Twilio Console → Phone Numbers → 사용할 번호:

| 설정 | 값 |
|------|-----|
| **A call comes in** | `https://your-domain.com/voice/incoming` |
| **Method** | `POST` |

---

## 8. 모니터링 명령어

```bash
# 서비스 상태
sudo systemctl status bluefone-ivr

# 실시간 로그
journalctl -u bluefone-ivr -f

# 서버 상태 (JSON)
curl -s http://localhost:8000/internal/status | python3 -m json.tool

# 수동 재시작
sudo systemctl restart bluefone-ivr

# 캐시 초기화
curl -X POST http://localhost:8000/internal/clear-cache
```

---

## 9. 문제 해결

### 서버 시작 안됨
```bash
# 로그 확인
journalctl -u bluefone-ivr -n 50 --no-pager

# 수동 실행으로 에러 확인
source /home/ubuntu/venv/bin/activate
cd /home/ubuntu/bluefone-ai-phone
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

### Google Sheets 연결 실패
```bash
# MOCK_MODE 확인
grep MOCK_MODE .env

# JSON 형식 확인
python3 -c "import json; json.loads('''$(grep GOOGLE_SERVICE_ACCOUNT_JSON .env | cut -d= -f2-)''')"
```

### Twilio Webhook 실패
```bash
# 서버 외부 접근 테스트 (다른 PC에서)
curl https://your-domain.com/health

# 방화벽 확인
sudo ufw status
sudo ufw allow 80
sudo ufw allow 443
```

---

## 아키텍처 요약

```
                    ┌─────────────┐
                    │   Twilio    │
                    └──────┬──────┘
                           │ HTTPS POST
                           ▼
┌──────────────────────────────────────────┐
│              Your Server                 │
│  ┌────────────┐    ┌─────────────────┐  │
│  │   Nginx    │───▶│  FastAPI:8000   │  │
│  │  (HTTPS)   │    │  (bluefone-ivr) │  │
│  └────────────┘    └────────┬────────┘  │
│                              │          │
│  ┌────────────┐    ┌────────▼────────┐  │
│  │   Cron     │───▶│  Google Sheets  │  │
│  │ (watchdog) │    │    (cached)     │  │
│  └────────────┘    └─────────────────┘  │
└──────────────────────────────────────────┘
```
