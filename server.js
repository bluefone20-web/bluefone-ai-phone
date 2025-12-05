// =============================================
// Bluefone AI – Whisper + GPT Call Assistant
// - Twilio Recording → Whisper(STT) → GPT 답변
// - Twilio Neural Voice로 자연스럽게 읽어줌
// =============================================
require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const twilio = require("twilio");
const fs = require("fs");
const path = require("path");
const OpenAI = require("openai");

// ===== 기본 초기화 =====
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

// ===== 영업시간 (브리즈번 기준 08:00 ~ 17:30) =====
function isBotActiveNow() {
  const now = new Date();
  const brisbaneHour = (now.getUTCHours() + 10) % 24;
  const minute = now.getUTCMinutes();

  const after1730 = brisbaneHour > 17 || (brisbaneHour === 17 && minute > 30);
  const before0800 = brisbaneHour < 8;
  return !(after1730 || before0800);
}

// ===== PRICE TABLE / CSV 로직 (있으면 쓰고, 없어도 동작) =====
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

// ===== GPT 답변 생성 =====
async function generateReply(userText) {
  const brand = detectBrand(userText);
  const cat = detectCategory(userText);
  const priceRow = findBestPrice(userText, brand);
  const info = cat ? describeCategory(cat) : null;

  // 브랜드/이슈별 빠른 룰
  if (brand === "xiaomi" || brand === "google") {
    return `
We currently do not provide repair services for Xiaomi or Google Pixel devices.
If you would like general advice, you are welcome to bring the phone in and we can at least take a quick look for you.
    `.trim();
  }

  if (isPowerIssue(userText)) {
    return `
If the phone does not power on, it might still be a battery or screen problem rather than the mainboard.
We need to test it in-store, which usually takes about 10 to 20 minutes.
Please feel free to visit the shop and we will check it for you.
    `.trim();
  }

  if (cat === "charge") {
    return `
Charging problems are often caused by dust or debris inside the charging port.
In many cases, a port cleaning for 20 AUD can fix the issue.
If we confirm physical damage on the port itself, we do not perform charging port hardware repairs.
    `.trim();
  }

  if (brand === "other") {
    return `
For this brand, repair prices can vary a lot depending on the exact model.
If you can tell us the exact model name, we can give a better estimate, or you can simply bring the phone in and we will identify it for you.
    `.trim();
  }

  if (brand === "unknown" && !priceRow) {
    return `
Could you please tell us which brand and model your phone is?
If you are not sure, you can bring the device into the shop and we will identify it and advise you directly.
    `.trim();
  }

  // GPT로 톤/구성 정리
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
  // Twilio Recording URL 확장자 보정 (.wav 붙이기)
  const finalUrl = recordingUrl.endsWith(".wav") ? recordingUrl : recordingUrl + ".wav";
  console.log("Recording URL:", finalUrl);

  // Twilio Basic Auth (SID:TOKEN)
  const authHeader =
    "Basic " +
    Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64");

  const audioRes = await fetch(finalUrl, {
    headers: { Authorization: authHeader },
  });

  if (!audioRes.ok) {
    const bodyText = await audioRes.text().catch(() => "");
    throw new Error(
      "Twilio download failed -> " + audioRes.status + " " + bodyText
    );
  }

  const buffer = Buffer.from(await audioRes.arrayBuffer());

  // Render같은 환경에서는 /tmp 사용
  const tmpFile = path.join("/tmp", `call_${Date.now()}.wav`);
  fs.writeFileSync(tmpFile, buffer);
  console.log("Saved temp audio:", tmpFile);

  // Whisper STT (한국어+영어 섞인 발음 최적화)
  const result = await openai.audio.transcriptions.create({
    file: fs.createReadStream(tmpFile),
    model: "whisper-1",
    language: "ko", // 한국어 우선 (영어 모델명도 같이 잘 잡음)
    prompt:
      "Caller is describing mobile phone repair issues, mixing Korean and English, with model names like iPhone, Samsung, Galaxy, screen cracked, not charging, battery problem, water damage, etc.",
  });

  try {
    fs.unlinkSync(tmpFile);
  } catch (e) {
    console.warn("Failed to delete temp audio:", e.message);
  }

  console.log("Whisper raw text:", result.text);
  return (result.text || "").trim();
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
    // 와이프 번호면 바로 연결
    if (WIFE_NUMBER && OWNER_MOBILE && from === WIFE_NUMBER) {
      twiml.say(
        { voice: "neural:woman", language: "en-AU" },
        "Hi, I will connect your call now."
      );
      twiml.dial(OWNER_MOBILE);
      res.type("text/xml");
      return res.send(twiml.toString());
    }

    // 영업시간 아니면 바로 사람에게 연결
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

    // Whisper 기반: 안내 + 통화 녹음
    twiml.say(
      { voice: "neural:woman", language: "en-AU" },
      `Hello, this is ${SHOP_NAME}. After the beep, please clearly tell me your phone model and the issue. For example, "iPhone 13 screen cracked" or "Samsung not charging".`
    );

    // 통화 녹음 후 /process-recording 으로 전송
    twiml.record({
      action: "/process-recording",
      method: "POST",
      maxLength: 20,        // 최대 20초 말 듣기
      playBeep: true,
      trim: "do-not-trim",  // 침묵도 자르지 말고 그대로 보내기
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

// ===== /process-recording: Whisper로 인식 → GPT 답변 후 읽기 =====
app.post("/process-recording", async (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();
  const recordingUrl = req.body.RecordingUrl;

  try {
    if (!recordingUrl) {
      console.error("No RecordingUrl in request body");
      twiml.say(
        { voice: "neural:woman", language: "en-AU" },
        "Sorry, I did not get your voice clearly. Please call us again."
      );
      twiml.hangup();
      res.type("text/xml");
      return res.send(twiml.toString());
    }

    console.log("Raw RecordingUrl:", recordingUrl);

    // 1) Whisper STT
    const text = await transcribeRecording(recordingUrl);
    console.log("Transcription:", text);

    if (!text) {
      twiml.say(
        { voice: "neural:woman", language: "en-AU" },
        "Sorry, I could not hear your message clearly. Please call us again and speak a little slower."
      );
      twiml.hangup();
      res.type("text/xml");
      return res.send(twiml.toString());
    }

    // 2) GPT 답변 생성
    const reply = await generateReply(text);
    console.log("GPT Reply:", reply);

    // 3) Neural Voice로 읽어줌
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