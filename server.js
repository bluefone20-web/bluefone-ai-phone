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

// ===== BASIC SETTINGS =====
const SHOP_NAME = process.env.SHOP_NAME || "Bluefone Mobile Repair";

// ===== PRICE TABLE =====
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
name: "Charging-related issue",
priceRange: [70, 150],
timeRange: [30, 60],
difficulty: 3
},
water: {
name: "Water damage check/clean",
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

// ===== BRAND DETECTION =====
function detectBrand(text = "") {
const t = text.toLowerCase();

if (
t.includes("iphone") ||
t.includes("ios") ||
t.includes("apple")
) return "apple";

if (
t.includes("samsung") ||
t.includes("galaxy")
) return "samsung";

// Xiaomi family
if (
t.includes("xiaomi") ||
t.includes("redmi") ||
t.includes("poco")
) return "xiaomi";

// Google Pixel
if (t.includes("pixel") || t.includes("google"))
return "google";

// Other brands we may or may not support fully
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
) return "other";

return "unknown";
}

// ===== CATEGORY DETECTION =====
function detectCategory(text = "") {
const t = text.toLowerCase();

if (
t.includes("screen") ||
t.includes("display") ||
t.includes("lcd") ||
t.includes("crack") ||
t.includes("smashed") ||
t.includes("glass")
) return "screen";

if (
t.includes("battery") ||
t.includes("drain") ||
t.includes("swollen") ||
t.includes("shuts off")
) return "battery";

if (
t.includes("charge") ||
t.includes("charging") ||
t.includes("charger") ||
t.includes("port") ||
t.includes("cable")
) return "charge";

if (
t.includes("water") ||
t.includes("liquid") ||
t.includes("wet") ||
t.includes("dropped in")
) return "water";

if (
t.includes("back glass") ||
t.includes("backglass") ||
t.includes("back cover") ||
(t.includes("back") && t.includes("crack"))
) return "backglass";

return null;
}

// ===== POWER ISSUE DETECTION =====
function isPowerIssue(text = "") {
const t = text.toLowerCase();
return (
t.includes("no power") ||
t.includes("not turning on") ||
t.includes("won't turn on") ||
t.includes("doesn't turn on") ||
t.includes("power issue") ||
t.includes("won t turn on") ||
t.includes("black screen with no power")
);
}

// ===== CATEGORY DESCRIPTION (FOR GPT CONTEXT) =====
function describeCategory(catKey) {
const cat = PRICE_TABLE[catKey];
if (!cat) return null;

const [pMin, pMax] = cat.priceRange;
const [tMin, tMax] = cat.timeRange;

return {
priceText: `Typical price range is about ${pMin} to ${pMax} AUD.`,
timeText: `Estimated turnaround time is about ${tMin} to ${tMax} minutes.`,
difficultyText:
cat.difficulty >= 4
? "The repair is slightly more complex and can sometimes take longer depending on the condition."
: "The repair difficulty is moderate in most cases."
};
}

// ===== GPT REPLY LOGIC =====
async function generateReply(userText) {
const brand = detectBrand(userText);
const cat = detectCategory(userText);

// --- 1) Xiaomi / Google Pixel -> we do NOT repair ---
if (brand === "xiaomi" || brand === "google") {
return `
We currently do not provide repair services for Xiaomi or Google Pixel devices.
If you’d like us to take a quick look and give you general advice, you are welcome to visit the store.
`.trim();
}

// --- 2) Power issues: might be simple, must check in-store ---
if (isPowerIssue(userText)) {
return `
If your phone does not power on, it can still sometimes be caused by simpler issues like the battery or screen rather than the mainboard.
To know for sure, we need to connect and test the device in-store, which usually takes about 10 to 20 minutes.
Please feel free to visit the shop and we’ll check it for you.
`.trim();
}

// --- 3) Charging issues: port cleaning + 20 AUD, damaged port not repaired ---
if (cat === "charge") {
return `
Charging problems are often caused by dust or debris inside the charging port.
In many cases, a charging port cleaning can fix the issue, and this service is 20 AUD.

If, after cleaning, we confirm physical damage on the port itself, we do not perform charging port hardware repairs.
You are welcome to bring the phone in so we can clean the port and check whether it can be fixed that way.
`.trim();
}

// --- 4) Other brands: request exact model ---
if (brand === "other") {
return `
For this brand, repair prices can vary a lot depending on the exact model.
If you can tell us the exact model name, we can give you a better estimate.
If you’re not sure of the model, you can simply bring the phone in and we’ll check it for you at the shop.
`.trim();
}

// --- 5) Brand unknown: ask for brand/model first ---
if (brand === "unknown") {
return `
Could you please tell us which brand and model your phone is?
If you are not sure, just bringing the device into the shop is perfectly fine and we can identify it and advise you in person.
`.trim();
}

// --- 6) Apple / Samsung + known category -> let GPT phrase using range info ---
const info = cat ? describeCategory(cat) : null;

const systemPrompt = `
You are the AI call assistant for "${SHOP_NAME}", a mobile phone repair shop in Australia.
You MUST ALWAYS reply in English only.

Rules:
- Be friendly, concise, and clear.
- Use 2–3 short sentences.
- Never promise mainboard / motherboard repair. Do NOT say "we repair mainboards".
- For Xiaomi and Google Pixel, we already return an early message (you don't need to handle them here).
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

// ===== HEALTH CHECK ENDPOINT =====
app.get("/", (req, res) => {
res.send("Bluefone AI Phone Assistant (English-only) is running.");
});

// ===== TWILIO VOICE WEBHOOK =====
app.post("/voice", async (req, res) => {
const twiml = new twilio.twiml.VoiceResponse();
const speech = req.body.SpeechResult;

try {
// First time: prompt the caller
if (!speech) {
const gather = twiml.gather({
input: "speech",
action: "/voice",
method: "POST",
speechTimeout: "auto"
});

gather.say(
{
voice: "woman",
language: "en-US"
},
`Hello, this is ${SHOP_NAME}.
Prices we mention over the phone are only estimates and may change after we inspect the actual device in-store.
Please describe your phone model and what issue you are having.`
);

res.type("text/xml");
return res.send(twiml.toString());
}

// We got caller speech, generate AI reply
const reply = await generateReply(speech);

twiml.say(
{
voice: "woman",
language: "en-US"
},
reply
);

twiml.say(
{
voice: "woman",
language: "en-US"
},
"If you have any other questions, you are always welcome to contact or visit us. Thank you."
);

twiml.hangup();

res.type("text/xml");
res.send(twiml.toString());
} catch (err) {
console.error("Error in /voice:", err);

twiml.say(
{
voice: "woman",
language: "en-US"
},
"Sorry, an error occurred on our system. Please call us again in a little while."
);
twiml.hangup();

res.type("text/xml");
res.send(twiml.toString());
}
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
console.log(`Bluefone AI Phone Assistant (English-only) running on port ${port}`);
});






