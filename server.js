// ===== Basic setup =====
require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const twilio = require("twilio");
const OpenAI = require("openai");

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));

const openai = new OpenAI({
apiKey: process.env.OPENAI_API_KEY
});

const SHOP_NAME = process.env.SHOP_NAME || "Bluefone Mobile Repair";

// ===== Whitelist numbers =====
// TODO: 여기를 네 상황에 맞게 바꿔줘
// 예: "+61412345678" 이런 식으로 Twilio에서 보이는 형식 그대로 쓰기
const WIFE_NUMBER = "0412772488"; // 와이프 핸드폰 번호
const OWNER_MOBILE = "0432229982"; // 네 개인 핸드폰 번호
const STAFF_MOBILE = "0451150521"; // 네 개인 핸드폰 번호

// ===== Price table (rough ranges) =====
const PRICE_TABLE = {
screen: {
name: "Screen replacement",
priceRange: [150, 280],
timeRange: [30, 60],
difficulty: 3
},
battery: {
name: "Battery replacement",
priceRange: [60, 120],
timeRange: [20, 30],
difficulty: 2
},
charge: {
name: "Charging issue",
priceRange: [70, 150],
timeRange: [30, 60],
difficulty: 3
},
water: {
name: "Water-damage check/clean",
priceRange: [60, 200],
timeRange: [60, 120],
difficulty: 4
},
backglass: {
name: "Back glass replacement",
priceRange: [130, 220],
timeRange: [90, 180],
difficulty: 4
}
};

// ===== Brand detection =====
function detectBrand(text = "") {
const t = text.toLowerCase();

if (t.includes("iphone") || t.includes("ios") || t.includes("apple"))
return "apple";

if (t.includes("samsung") || t.includes("galaxy") || t.includes("삼성") || t.includes("갤럭시"))
return "samsung";

if (t.includes("xiaomi") || t.includes("redmi") || t.includes("poco") || t.includes("샤오미"))
return "xiaomi";

if (t.includes("pixel") || t.includes("google"))
return "google";

if (
t.includes("oppo") || t.includes("vivo") || t.includes("motorola") ||
t.includes("moto") || t.includes("nokia") || t.includes("nothing") ||
t.includes("zte") || t.includes("sony") || t.includes("htc")
)
return "other";

return "unknown";
}

// ===== Category detection =====
function detectCategory(text = "") {
const t = text.toLowerCase();

if (
t.includes("screen") || t.includes("display") || t.includes("lcd") ||
t.includes("crack") || t.includes("smashed") || t.includes("glass")
) return "screen";

if (
t.includes("battery") || t.includes("drain") || t.includes("swollen") ||
t.includes("shuts off")
) return "battery";

if (
t.includes("charge") || t.includes("charging") || t.includes("charger") ||
t.includes("port") || t.includes("cable")
) return "charge";

if (
t.includes("water") || t.includes("liquid") || t.includes("wet") ||
t.includes("dropped in")
) return "water";

if (
t.includes("back glass") || t.includes("backglass") ||
t.includes("back cover") || (t.includes("back") && t.includes("crack"))
) return "backglass";

return null;
}

// ===== Power issue detection =====
function isPowerIssue(text = "") {
const t = text.toLowerCase();
return (
t.includes("no power") ||
t.includes("not turning on") ||
t.includes("won't turn on") ||
t.includes("doesn't turn on") ||
t.includes("power issue") ||
t.includes("부팅 안") ||
t.includes("전원 안") ||
t.includes("안 켜져") ||
t.includes("켜지지")
);
}

// ===== Category description helper =====
function describeCategory(catKey) {
const cat = PRICE_TABLE[catKey];
if (!cat) return null;

const [pMin, pMax] = cat.priceRange;
const [tMin, tMax] = cat.timeRange;

return {
priceText: `Typical price range is about ${pMin} to ${pMax} AUD.`,
timeText: `Estimated turnaround time is around ${tMin} to ${tMax} minutes.`,
difficultyText:
cat.difficulty >= 4
? "The repair is a bit more complex and can sometimes take longer depending on the condition."
: "The repair difficulty is moderate in most cases."
};
}

// ===== GPT reply =====
async function generateReply(userText) {
const brand = detectBrand(userText);
const cat = detectCategory(userText);

// Xiaomi / Google Pixel not supported
if (brand === "xiaomi" || brand === "google") {
return `
We currently do not provide repair services for Xiaomi or Google Pixel devices.
If you would like general advice, you are welcome to bring the phone in and we can at least take a quick look for you.
`.trim();
}

// Power issues (no power)
if (isPowerIssue(userText)) {
return `
If the phone does not power on, sometimes it is still caused by simpler issues like the battery or screen rather than the mainboard.
To know for sure, we need to test the device in-store, which usually takes about 10 to 20 minutes.
Please feel free to visit the shop and we will check it for you.
`.trim();
}

// Charging issues → cleaning 20 AUD, no port hardware repair
if (cat === "charge") {
return `
Charging problems are often caused by dust or debris inside the charging port.
In many cases, a charging port cleaning can fix the issue, and this service is 20 AUD.

If, after cleaning, we confirm physical damage on the port itself, we do not perform charging port hardware repairs.
You are welcome to bring the phone in so we can clean the port and check whether it can be fixed that way.
`.trim();
}

// Other Android brands → ask exact model
if (brand === "other") {
return `
For this brand, repair prices can vary a lot depending on the exact model.
If you can tell us the exact model name, we can give you a better estimate.
If you are not sure of the model, just bringing the phone into the shop is perfectly fine and we can identify it and advise you in person.
`.trim();
}

// Unknown brand → ask brand/model
if (brand === "unknown") {
return `
Could you please tell us which brand and model your phone is?
If you are not sure, you can simply bring the device into the shop and we will identify it and advise you directly.
`.trim();
}

const info = cat ? describeCategory(cat) : null;

const systemPrompt = `
You are the AI call assistant for "${SHOP_NAME}", a mobile phone repair shop in Australia.
You MUST ALWAYS reply in English only.

Rules:
- Be friendly, concise, and clear.
- Use 2–3 short sentences.
- Never promise mainboard / motherboard repair. Do NOT say "we repair mainboards".
- For Xiaomi and Google Pixel, we already handle them separately.
- If price or time info is provided, speak in ranges like "about X to Y AUD" and "around A to B minutes".
- Always encourage the customer to visit the shop for a proper inspection.
`;

const userPrompt = `
The customer said: "${userText}".
Detected brand: ${brand}
Detected category: ${cat}
Additional info: ${info ? JSON.stringify(info) : "no extra info"}
Please respond in English only, 2–3 sentences, using the additional info naturally if it exists.
`;

const completion = await openai.chat.completions.create({
model: "gpt-4o-mini",
messages: [
{ role: "system", content: systemPrompt },
{ role: "user", content: userPrompt }
]
});

return completion.choices[0].message.content.trim();
}

// ===== Health check =====
app.get("/", (req, res) => {
res.send("Bluefone AI Phone Assistant (English-only, with whitelist) is running.");
});

// ===== Twilio Voice Webhook =====
app.post("/webhook", async (req, res) => {
const twiml = new twilio.twiml.VoiceResponse();
const from = req.body.From || "";
const speech = req.body.SpeechResult;

try {
// 1) Wife whitelist: if the call is from wife, bypass AI and forward directly
if (from === WIFE_NUMBER) {
twiml.say({ voice: "woman", language: "en-US" }, "Hi, I will connect your call now.");
twiml.dial(OWNER_MOBILE);
res.type("text/xml");
return res.send(twiml.toString());
}

// 2) First step: no SpeechResult yet → ask question using <Gather>
if (!speech) {
const gather = twiml.gather({
input: "speech",
action: "/webhook",
method: "POST",
speechTimeout: "auto"
});

gather.say(
{ voice: "woman", language: "en-US" },
`Hello, this is ${SHOP_NAME}.
Prices we mention over the phone are only estimates and may change after we inspect the actual device in-store.
Please tell me your phone model and what issue you are having.`
);

res.type("text/xml");
return res.send(twiml.toString());
}

// 3) We got caller speech → generate AI reply
const reply = await generateReply(speech);

twiml.say({ voice: "woman", language: "en-US" }, reply);
twiml.say(
{ voice: "woman", language: "en-US" },
"If you have any other questions, you are always welcome to visit or contact us. Thank you."
);
twiml.hangup();

res.type("text/xml");
res.send(twiml.toString());
} catch (err) {
console.error("Error in /webhook:", err);
twiml.say(
{ voice: "woman", language: "en-US" },
"Sorry, there was an error on our system. Please call us again in a little while."
);
twiml.hangup();
res.type("text/xml");
res.send(twiml.toString());
}
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
console.log(`Bluefone AI Phone Assistant running on port ${port}`);
});