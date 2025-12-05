// =====================================================
// Bluefone AI 24/7 Phone Assistant
// Whisper (KR/EN) → model name (EN) → inventory.js price
// =====================================================
require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const twilio = require("twilio");
const fs = require("fs");
const path = require("path");
const OpenAI = require("openai");

// === 로컬 가격 DB (inventory.js) 사용 ===
const inv = require("./inventory");

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SHOP_NAME = process.env.SHOP_NAME || "Bluefone Mobile Repair";
const WIFE_NUMBER = process.env.WIFE_NUMBER || "";
const OWNER_MOBILE = process.env.OWNER_MOBILE || "";
const STAFF_MOBILE = process.env.STAFF_MOBILE || "";

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;

// ============= Whisper: 음성 → 텍스트 (한국어/영어 둘 다) =============
async function transcribe(recordingUrl) {
  if (!recordingUrl) return "";

  const url = recordingUrl.endsWith(".wav")
    ? recordingUrl
    : recordingUrl + ".wav";

  const auth =
    "Basic " +
    Buffer.from(
      `${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`
    ).toString("base64");

  const res = await fetch(url, { headers: { Authorization: auth } });
  if (!res.ok) throw new Error("Twilio audio fetch failed " + res.status);

  const buf = Buffer.from(await res.arrayBuffer());
  const tmp = "/tmp/" + Date.now() + ".wav";
  fs.writeFileSync(tmp, buf);

  const result = await openai.audio.transcriptions.create({
    file: fs.createReadStream(tmp),
    model: "whisper-1",
    // 한국어/영어 섞여도 알아듣게
    language: "ko",
    prompt:
      "Caller is talking about a phone model and repair issue. Model names like iPhone 13 Pro Max, Galaxy S24 Ultra, iPad 9th gen.",
  });

  fs.unlinkSync(tmp);
  console.log("Whisper text:", result.text);
  return result.text.trim();
}

// ===== GPT: 한국어 문장에서 '영어 모델명'만 뽑아내기 =====
async function extractModelName(userText) {
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content:
          "You receive Korean or English sentences about phone repairs. " +
          "Extract ONLY the phone/device model name in English, without extra words. " +
          "Examples: '아이폰 13 프로 맥스 액정' -> 'iPhone 13 Pro Max', " +
          "'갤럭시 S24 울트라 화면' -> 'GALAXY S24 ULTRA', " +
          "'아이패드 9세대 액정' -> 'IPAD 9th gen'. " +
          "If you are not sure, answer exactly: UNKNOWN",
      },
      {
        role: "user",
        content: userText,
      },
    ],
  });

  const modelName = completion.choices[0].message.content.trim();
  console.log("🧠 Parsed model name from GPT:", modelName);
  return modelName;
}

// ============== 응답 생성 로직 (inventory.js + GPT) ==============
async function generateReply(userText) {
  // 1) 문장에서 영어 모델명 추출
  const modelName = await extractModelName(userText);
  if (!modelName || modelName === "UNKNOWN") {
    return (
      "I could not detect the exact model from your voice. " +
      "Please say the precise model name, for example 'iPhone 13 Pro Max screen'."
    );
  }

  // 2) inventory.js 에서 가격 찾기
  const priceInfo = inv.findPrice(modelName);
  console.log("🔍 Price match:", priceInfo);

  if (!priceInfo) {
    return (
      `I could not find a saved price for ${modelName}. ` +
      "Please check with the staff in store for an exact quote."
    );
  }

  // 3) 가격 안내 멘트
  return (
    `For ${priceInfo.brand} ${priceInfo.device} ${priceInfo.model} ` +
    `${priceInfo.variant}, the estimated price is about $${priceInfo.price} Australian dollars. ` +
    "The final price may change after checking the device in store."
  );
}

// ==================== TWILIO VOICE WEBHOOK ====================
app.post("/webhook", async (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();
  const from = req.body.From;

  // 와이프 번호면 바로 연결
  if (WIFE_NUMBER && OWNER_MOBILE && from === WIFE_NUMBER) {
    twiml.say(
      { voice: "woman", language: "en-AU" },
      "Hi, I will connect your call now."
    );
    twiml.dial(OWNER_MOBILE);
    res.type("text/xml");
    return res.send(twiml.toString());
  }

  // 일반 손님: 설명 요청
  twiml.say(
    { voice: "woman", language: "en-AU" },
    `Hello, this is ${SHOP_NAME}. After the beep, please say your phone model and issue.`
  );

  twiml.record({
    action: "/process-recording",
    method: "POST",
    playBeep: true,
    trim: "do-not-trim",
    maxLength: 60,
  });

  res.type("text/xml");
  res.send(twiml.toString());
});

// Whisper → GPT model 추출 → inventory 가격 안내
app.post("/process-recording", async (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();
  try {
    const text = await transcribe(req.body.RecordingUrl);
    const answer = await generateReply(text);

    twiml.say({ voice: "woman", language: "en-AU" }, answer);
    twiml.say(
      { voice: "woman", language: "en-AU" },
      "Thank you for calling. Goodbye!"
    );
    twiml.hangup();
  } catch (e) {
    console.error("Error in /process-recording:", e);
    twiml.say(
      { voice: "woman", language: "en-AU" },
      "Sorry, there was a system error. Please call again later."
    );
    twiml.hangup();
  }

  res.type("text/xml");
  res.send(twiml.toString());
});

// Health check
app.get("/", (req, res) => {
  res.send("Bluefone AI 24/7 Call Assistant is running.");
});

// =================== SERVER RUN ===========================
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`BLUEFONE AI 24H Call Assistant running on port ${port}`);

  // 로컬 테스트용: inventory 에서 한 번 가격 찍어보기
  const testPrice = inv.findPrice("iPhone 13 Pro Max");
  console.log("💰 Test price for iPhone 13 Pro Max:", testPrice);
});