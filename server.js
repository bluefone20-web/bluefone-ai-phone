// =============================================
// Bluefone AI – VOICE GENERATION CALL SYSTEM
// High quality TTS + GPT phone automation bot
// =============================================
require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const twilio = require("twilio");
const fs = require("fs");
const OpenAI = require("openai");

// ============ INIT ===========================
const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use("/audio", express.static("voices")); // ← Twilio가 mp3 파일 재생 가능

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SHOP_NAME = "Bluefone Mobile Repair";

// ============ ADVANCED SPEECH GENERATION ======
async function generateVoice(text) {
const response = await openai.audio.speech.create({
model: "gpt-4o-mini-tts",
voice: "spark", // alloy/spark/verse/dusty 선택 가능
input: text,
format: "mp3"
});

const buffer = Buffer.from(await response.arrayBuffer());
const fileName = `response_${Date.now()}.mp3`;
const filePath = `voices/${fileName}`;
fs.writeFileSync(filePath, buffer);

return `/audio/${fileName}`; // Twilio에서 재생 가능한 URL 반환
}

// ============ GPT 답변 생성 로직 =================
async function generateReply(user) {
const completion = await openai.chat.completions.create({
model: "gpt-4o-mini",
messages: [
{ role:"system", content:`You are polite, concise, professional. Always reply as if speaking through a phone.` },
{ role:"user", content:user }
]
});
return completion.choices[0].message.content.trim();
}

// ============ CALL FLOW ========================
app.post("/webhook", async (req,res)=>{
const twiml = new twilio.twiml.VoiceResponse();
const speech = req.body.SpeechResult;

// ================== 1) 최초 안내 =====================
if(!speech){
const g = twiml.gather({
input:"speech",
action:"/webhook",
method:"POST",
speechTimeout:"auto"
});

// 첫 인사 default는 neural 여자톤
g.say({ voice:"neural:woman", language:"en-US" },
`Hi, this is ${SHOP_NAME}. Tell me your phone model and issue.`);

return res.type("text/xml").send(twiml.toString());
}

// ================== 2) GPT 응답 생성 ==================
const reply = await generateReply(speech);

// ================== 3) OpenAI TTS → mp3 생성 ==========
const audioPath = await generateVoice(reply);

// ================== 4) 고객에게 mp3 재생 ==============
twiml.play(`https://${process.env.SERVER_URL}${audioPath}`);
twiml.say({voice:"neural:woman"}, "Thank you for calling, bye.");
twiml.hangup();

return res.type("text/xml").send(twiml.toString());
});

// ============ LAUNCH ============================
app.get("/",(_,res)=>res.send("🔥 Bluefone Advanced Voice AI Running"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=>{
console.log("🚀 Advanced Voice AI Launched on PORT",PORT);
});