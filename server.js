// =============================================
// Bluefone AI – Whisper + GPT 24hr Call Assistant
// ※ Business hour 제한 없음 — Always ON
// =============================================
require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const twilio = require("twilio");
const fs = require("fs");
const path = require("path");
const OpenAI = require("openai");

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SHOP_NAME = process.env.SHOP_NAME || "Bluefone Mobile Repair";

const WIFE_NUMBER = process.env.WIFE_NUMBER || "";
const OWNER_MOBILE = process.env.OWNER_MOBILE || "";
const STAFF_MOBILE = process.env.STAFF_MOBILE || "";

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;

// === CSV 가격 시스템 유지 ===
let PRICE_DATA = [];
function parseCsv(text) {
const lines = text.trim().split(/\r?\n/);
const headers = lines[0].split(",").map(h=>h.trim().toLowerCase());
return lines.slice(1).map(row=>{
const cols = row.split(",");
const obj = {};
headers.forEach((h,i)=> obj[h]=cols[i]?cols[i].trim():"");
obj.price = Number(obj.price || 0);
return obj;
}).filter(r=>r.model && r.price>0);
}

async function loadPriceData() {
if (!process.env.PRICE_SHEET_URL) return;
const r = await fetch(process.env.PRICE_SHEET_URL);
PRICE_DATA = parseCsv(await r.text());
console.log(`Loaded ${PRICE_DATA.length} price rows from sheet.`);
}

// === Whisper 음성 → 텍스트 ===
async function transcribe(recordingUrl){
if(!recordingUrl) return "";

const url = recordingUrl.endsWith(".wav") ? recordingUrl : recordingUrl + ".wav";
const auth = "Basic "+Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64");

const res = await fetch(url,{ headers:{Authorization:auth}});
if(!res.ok) throw new Error("Twilio audio fetch failed "+res.status);

const buf = Buffer.from(await res.arrayBuffer());
const tmp = "/tmp/"+Date.now()+".wav";
fs.writeFileSync(tmp,buf);

const text = await openai.audio.transcriptions.create({
file: fs.createReadStream(tmp),
model:"whisper-1",
language:"ko",
prompt:"Customer describes phone repair issues."
});

fs.unlinkSync(tmp);
console.log("Whisper:",text.text);
return text.text.trim();
}

// === GPT 응답 ===
async function replyGPT(userText){
const completion = await openai.chat.completions.create({
model:"gpt-4o-mini",
messages:[
{role:"system",content:`You are call assistant for ${SHOP_NAME}. Keep reply short, friendly, clear.`},
{role:"user",content:`User said: ${userText}`}
]
});
return completion.choices[0].message.content.trim();
}

// === Twilio Webhook — 24시간 즉시 응답 ===
app.post("/webhook", async(req,res)=>{
const twiml = new twilio.twiml.VoiceResponse();
const from = req.body.From;

// 🔥 와이프 → 바로 연결 (예외 유지)
if(WIFE_NUMBER && OWNER_MOBILE && from===WIFE_NUMBER){
twiml.say({voice:"neural:woman",language:"en-AU"},"Connecting you now, honey.");
twiml.dial(OWNER_MOBILE);
res.type("text/xml"); return res.send(twiml.toString());
}

twiml.say(
{ voice:"neural:woman", language:"en-AU" },
`Hello this is ${SHOP_NAME}. After the beep please describe your phone model and issue.`
);

// 🔥 60초까지 말 가능
twiml.record({
action:"/process-recording",
method:"POST",
playBeep:true,
trim:"do-not-trim",
maxLength:60
});

res.type("text/xml");
res.send(twiml.toString());
});

// === Whisper → GPT → TTS응답 ===
app.post("/process-recording", async(req,res)=>{
const twiml = new twilio.twiml.VoiceResponse();
try{
const text = await transcribe(req.body.RecordingUrl);
const answer = await replyGPT(text);

twiml.say({voice:"neural:woman",language:"en-AU"},answer);
twiml.say({voice:"neural:woman",language:"en-AU"},"Thank you for calling. Goodbye!");
twiml.hangup();
}catch(e){
console.error(e);
twiml.say("System error occurred. Try calling again.");
twiml.hangup();
}

res.type("text/xml");
res.send(twiml.toString());
});

// === Server Boot ===
const port=process.env.PORT||3000;
app.listen(port,()=>{
console.log(`BLUEFONE AI now running 24 HOURS on port ${port}`);
loadPriceData();
});