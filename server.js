// =============================================
// Bluefone AI – Whisper + GPT Call Assistant
// - Whisper(STT)로 통화 녹음 인식
// - GPT로 답변 생성
// - Twilio Neural Voice로 자연스럽게 읽기
// =============================================
require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const twilio = require("twilio");
const fs = require("fs");
const path = require("path");
const OpenAI = require("openai");

// ===== Basic init =====
const app = express();
app.use(bodyParser.urlencoded({ extended: false }));

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const SHOP_NAME = process.env.SHOP_NAME || "Bluefone Mobile Repair";

const WIFE_NUMBER = process.env.WIFE_NUMBER || "";
const OWNER_MOBILE = process.env.OWNER_MOBILE || "";
const STAFF_MOBILE = process.env.STAFF_MOBILE || "";

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;

// ===== Business hours (Brisbane) =====
function isBotActiveNow() {
  const now = new Date();
  const brisbaneHour = (now.getUTCHours() + 10) % 24;
  const minute = now.getUTCMinutes();

  const after1730 = brisbaneHour > 17 || (brisbaneHour === 17 && minute > 30);
  const before0800 = brisbaneHour < 8;
  return !(after1730 || before0800);
}

// ===== PRICE TABLE / CSV 로직 (있으면 그대로 활용, 없어도 동작) =====
const PRICE_TABLE = {
  screen: { priceRange: [150, 280], timeRange: [30, 60], difficulty: 3 },
  battery: { priceRange: [60, 120], timeRange: [20, 40], difficulty: 2 },
  charge: { priceRange: [50, 120], timeRange: [20, 60], difficulty: 3 },
  water: { priceRange: [80, 220], timeRange: [60, 120], difficulty: 4 },
  backglass: { priceRange: [150, 260], timeRange: [90, 180], difficulty: 4 },
};

let PRICE_DATA = [];

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const [headerLine, ...rows] = lines;
  const headers = headerLine.split(",").map((h) => h.trim().toLowerCase());

  return rows
    .map((line) => line.split(","))
    .filter((cols) => cols.length >= 2)
    .map((cols) => {
      const obj = {};
      headers.forEach((h, idx) => {
        obj[h] = cols[idx] ? cols[idx].trim() : "";
      });
      if (obj.price) {
        obj.price = Number(String(obj.price).replace(/[^0-9.]/g, ""));
      } else {
        obj.price = 0;
      }
      return obj;
    })
    .filter((obj) => !!obj.model && obj.price > 0);
}

async function loadPriceData() {
  const url = process.env.PRICE_SHEET_URL;
  if (!url) {
    console.warn("PRICE_SHEET_URL not set, skipping CSV load.");
    return;
  }
  try {
    const res = await fetch(url);
    const text = await res.text();
    PRICE_DATA = parseCsv(text);
    console.log(`Loaded ${PRICE_DATA.length} price rows from sheet.`);
  } catch (err) {
    console.error("Failed to load price data:", err);
  }
}

function normalize(str = "") {
  return str
    .toLowerCase()
    .replace(/iphone/g, "")
    .replace(/ipad/g, "")
    .replace(/galaxy/g, "")
    .replace(/samsung/g, "")
    .replace(/apple/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function findBestPrice(userText, brandHint) {
  if (!PRICE_DATA.length) return null;
  const normUser = normalize(userText);
  const candidates = PRICE_DATA.filter((row) => {
    const b = (row.brand || "").toLowerCase();
    if (brandHint === "apple" && !b.includes("apple")) return false;
    if (brandHint === "samsung" && !b.includes("samsung")) return false;
    return true;
  });

  let best = null;
  let bestScore = 0;
  for (const row of candidates) {
    const normModel = normalize(row.model || "");
    if (!normModel) continue;
    if (normUser.includes(normModel)) {
      const score = normModel.length;
      if (score > bestScore) {
        bestScore = score;
        best = row;
      }
    }
  }
  return best;
}

function detectBrand(text = "") {
  const t = text.toLowerCase();
  if (t.includes("iphone") || t.includes("ios") || t.includes("apple") || t.includes("ipad"))
    return "apple";
  if (t.includes("samsung") || t.includes("galaxy")) return "samsung";
  if (t.includes("xiaomi") || t.includes("redmi") || t.includes("poco") || t.includes("샤오미"))
    return "xiaomi";
  if (t.includes("pixel") || t.includes("google")) return "google";
  if (
    t.includes("oppo") ||
    t.includes("vivo") ||
    t.includes("motorola") ||
    t.includes("moto") ||
    t.includes("nokia") ||
    t.includes("nothing") ||
    t.includes("zte") ||
    t.includes("sony") ||
    t.includes("htc")
  )
    return "other";
  return "unknown";
}

function detectCategory(text = "") {
  const t = text.toLowerCase();
  if (/screen|display|lcd|crack|smashed|glass/.test(t)) return "screen";
  if (/battery|drain|swollen|shuts off/.test(t)) return "battery";
  if (/charge|charging|charger|port|cable/.test(t)) return "charge";
  if (/water|liquid|wet|dropped in/.test(t)) return "water";
  if (/back glass|backglass|back cover/.test(t) || (t.includes("back") && t.includes("crack")))
    return "backglass";
  return null;
}

function isPowerIssue(text = "") {
  const t = text.toLowerCase();
  return /(no power|not turning on|won't turn on|doesn't turn on|power issue|won t turn on|black screen with no power|부팅 안|전원 안|안 켜져|켜지지)/.test(
    t
  );
}

function describeCategory(catKey) {
  const cat = PRICE_TABLE[catKey];
  if (!cat) return null;
  const [pMin, pMax] = cat.priceRange;
  const [tMin, tMax] = cat.timeRange;
  return {
    priceText: `Typical price range is about ${pMin} to ${pMax} AUD.`,
    timeText: `Estimated turnaround time is around ${tMin} to ${tMax} minutes.`,
  };
}

// ===== GPT reply 로직 (이전 코드 유지, STT만 Whisper로 바뀜) =====
async function generateReply(userText) {
  const brand = detectBrand(userText);
  const cat = detectCategory(userText);
  const priceRow = findBestPrice(userText, brand);
  const info = cat ? describeCategory(cat) : null;

  if (brand === "xiaomi" || brand === "google") {
    return `
We currently do not provide repair services for Xiaomi or Google Pixel devices.
If you would like general advice, you are welcome to bring the phone in and we can at least take a quick look for you.
    `.trim();
  }

  if (isPowerIssue(userText)) {
    return `
If the phone does not power on, sometimes it is still caused by simpler issues like the battery or screen rather than the mainboard.
To know for sure, we need to test the device in-store, which usually takes about 10 to 20 minutes.
Please feel free to visit the shop and we will check it for you.
    `.trim();
  }

  if (cat === "charge") {
    return `
Charging problems are often caused by dust or debris inside the charging port.
In many cases, a charging port cleaning can fix the issue, and this service is 20 AUD.

If, after cleaning, we confirm physical damage on the port itself, we do not perform charging port hardware repairs.
You are welcome to bring the phone in so we can clean the port and check whether it can be fixed that way.
    `.trim();
  }

  if (brand === "other") {
    return `
For this brand, repair prices can vary a lot depending on the exact model.
If you can tell us the exact model name, we can give you a better estimate.
If you are not sure of the model, just bringing the phone into the shop is perfectly fine and we can identify it and advise you in person.
    `.trim();
  }

  if (brand === "unknown" && !priceRow) {
    return `
Could you please tell us which brand and model your phone is?
If you are not sure, you can simply bring the device into the shop and we will identify it and advise you directly.
    `.trim();
  }

  // GPT로 톤/구성 미세 조정
  const systemPrompt = `
You are the AI call assistant for "${SHOP_NAME}", a mobile phone repair shop in Australia.
You MUST ALWAYS reply in English only, as if speaking on the phone.

Rules:
- Be friendly, concise, and clear.
- Use 2–3 short sentences.
- Never promise mainboard / motherboard repair. Do NOT say "we repair mainboards".
- If an exact price row is provided, use that price for the quote (e.g., "around 190 AUD").
- If only a category range is provided, speak in ranges like "about X to Y AUD".
- Always remind that phone estimates can change after inspection in-store.
- Encourage the customer to visit the shop for a proper inspection.
  `;

  const userPrompt = `
Customer said: "${userText}".

Detected brand: ${brand}
Detected category: ${cat}

Exact price row from CSV (may be null):
${priceRow ? JSON.stringify(priceRow) : "null"}

Category-level fallback info (may be null):
${info ? JSON.stringify(info) : "null"}
  `;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });

  return completion.choices[0].message.content.trim();
}

// ===== Whisper STT: Twilio Recording 다운로드 → OpenAI 전송 =====
async function transcribeRecording(recordingUrl) {
  // Twilio Recording URL에서 음성 다운로드
  // Twilio는 Basic Auth 필요
  const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64");

  const res = await fetch(recordingUrl, {
    headers: {
      Authorization: `Basic ${auth}`,
    },
  });

  if (!res.ok) {
    throw new Error("Failed to download recording from Twilio: " + res.status);
  }

  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const tmpDir = path.join(__dirname, "tmp");
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir);
  }
  const filePath = path.join(tmpDir, `call_${Date.now()}.wav`);
  fs.writeFileSync(filePath, buffer);

  // Whisper(또는 gpt-4o-mini-transcribe)로 음성 → 텍스트
  const transcription = await openai.audio.transcriptions.create({
    file: fs.createReadStream(filePath),
    model: "gpt-4o-mini-transcribe", // 또는 "whisper-1"
    // language: "en", // 한국어+영어 섞어 말해도 잘 잡힘
  });

  // 임시 파일 삭제 (선택)
  try {
    fs.unlinkSync(filePath);
  } catch (e) {}

  return transcription.text.trim();
}

// ===== Health check =====
app.get("/", (req, res) => {
  res.send("Bluefone Whisper + GPT Call Assistant is running.");
});

// ===== /webhook: 첫 진입 (인사 + 녹음 시작) =====
app.post("/webhook", async (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();
  const from = req.body.From || "";

  try {
    // 0) 와이프 번호면 바로 연결
    if (WIFE_NUMBER && OWNER_MOBILE && from === WIFE_NUMBER) {
      twiml.say(
        { voice: "neural:woman", language: "en-AU" },
        "Hi, I will connect your call now."
      );
      twiml.dial(OWNER_MOBILE);
      res.type("text/xml");
      return res.send(twiml.toString());
    }

    // 1) 영업시간 아닐 때 → 바로 사람에게
    if (!isBotActiveNow()) {
      if (OWNER_MOBILE) {
        twiml.say(
          { voice: "neural:woman", language: "en-AU" },
          "Our AI assistant is currently offline. I will connect you now."
        );
        twiml.dial(OWNER_MOBILE);
      } else {
        twiml.say(
          { voice: "neural:woman", language: "en-AU" },
          "Our AI assistant is currently offline. Please call again during our business hours."
        );
        twiml.hangup();
      }
      res.type("text/xml");
      return res.send(twiml.toString());
    }

    // 2) Whisper 기반: 안내 + 통화 녹음
    twiml.say(
      { voice: "neural:woman", language: "en-AU" },
      `Hello, this is ${SHOP_NAME}. After the beep, please clearly tell me your phone model and the issue. For example, iPhone 13 screen cracked, or Samsung not charging.`
    );

    // 통화 일부분 녹음 → /process-recording 으로 POST
    twiml.record({
      action: "/process-recording",
      method: "POST",
      maxLength: 15, // 15초까지 듣고 잘라서 보냄
      playBeep: true,
      trim: "trim-silence",
    });

    res.type("text/xml");
    res.send(twiml.toString());
  } catch (err) {
    console.error("Error in /webhook:", err);
    twiml.say(
      { voice: "neural:woman", language: "en-AU" },
      "Sorry, there was an error on our system. Please call us again in a little while."
    );
    twiml.hangup();
    res.type("text/xml");
    res.send(twiml.toString());
  }
});

// ===== /process-recording: Whisper로 인식 → GPT 답변 후 읽어주기 =====
app.post("/process-recording", async (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();
  const recordingUrl = req.body.RecordingUrl; // Twilio가 보내줌

  try {
    if (!recordingUrl) {
      twiml.say(
        { voice: "neural:woman", language: "en-AU" },
        "Sorry, I did not get your voice clearly. Please call us again."
      );
      twiml.hangup();
      res.type("text/xml");
      return res.send(twiml.toString());
    }

    console.log("Recording URL:", recordingUrl);

    // 1) Whisper로 음성 → 텍스트
    const text = await transcribeRecording(recordingUrl);
    console.log("Transcription:", text);

    // 2) GPT로 답변 생성
    const reply = await generateReply(text);
    console.log("GPT Reply:", reply);

    // 3) Twilio Neural Voice로 읽기
    twiml.say({ voice: "neural:woman", language: "en-AU" }, reply);
    twiml.say(
      { voice: "neural:woman", language: "en-AU" },
      "If you have any other questions, you are always welcome to visit or contact us. Thank you."
    );
    twiml.hangup();

    res.type("text/xml");
    res.send(twiml.toString());
  } catch (err) {
    console.error("Error in /process-recording:", err);
    twiml.say(
      { voice: "neural:woman", language: "en-AU" },
      "Sorry, there was an error while listening to your message. Please call us again in a little while."
    );
    twiml.hangup();
    res.type("text/xml");
    res.send(twiml.toString());
  }
});

// ===== 서버 시작 =====
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Bluefone Whisper+GPT Call Assistant running on port ${port}`);
  loadPriceData();
});