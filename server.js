// ===== Basic setup =====
require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const twilio = require("twilio");
const OpenAI = require("openai");

// Node 18+ 에서는 fetch 내장
const app = express();
app.use(bodyParser.urlencoded({ extended: false }));

const openai = new OpenAI({
apiKey: process.env.OPENAI_API_KEY,
});

const SHOP_NAME = process.env.SHOP_NAME || "Bluefone Mobile Repair";

// ===== Whitelist numbers =====
const WIFE_NUMBER = process.env.WIFE_NUMBER || "";
const OWNER_MOBILE = process.env.OWNER_MOBILE || "";
const STAFF_MOBILE = process.env.STAFF_MOBILE || "";

// ===== Business Hours (Brisbane) =====
function isBotActiveNow() {
const now = new Date();
const brisbaneHour = (now.getUTCHours() + 10) % 24;
const minute = now.getUTCMinutes();
return !(brisbaneHour < 8 || (brisbaneHour > 17 || (brisbaneHour === 17 && minute > 30)));
}

// ===== CSV Price Table =====
let PRICE_DATA = [];
function parseCsv(text) {
const lines = text.trim().split(/\r?\n/);
if (lines.length < 2) return [];

const [header, ...rows] = lines;
const heads = header.split(",").map(h => h.trim().toLowerCase());

return rows.map(row => {
const cols = row.split(",");
const obj = {};
heads.forEach((h,i)=> obj[h] = cols[i]?.trim() || "");
obj.price = Number((obj.price||"").replace(/[^0-9.]/g,""));
return obj;
}).filter(o => o.model && o.price>0);
}

async function loadPriceData() {
try {
const r = await fetch(process.env.PRICE_SHEET_URL);
const t = await r.text();
PRICE_DATA = parseCsv(t);
console.log(`Loaded ${PRICE_DATA.length} rows`);
} catch(e){
console.error("CSV LOAD FAIL:",e);
}
}

function normalize(s=""){
return s.toLowerCase()
.replace(/iphone|ipad|galaxy|samsung|apple/gi,"")
.replace(/\s+/g," ").trim();
}

function detectBrand(t=""){
t=t.toLowerCase();
if(t.includes("iphone")||t.includes("ios")||t.includes("apple")||t.includes("ipad")) return "apple";
if(t.includes("samsung")||t.includes("galaxy")) return "samsung";
if(t.includes("xiaomi")||t.includes("redmi")||t.includes("poco")||t.includes("샤오미")) return "xiaomi";
if(t.includes("pixel")||t.includes("google")) return "google";
if(/oppo|vivo|motorola|moto|nokia|nothing|zte|sony|htc/i.test(t)) return "other";
return "unknown";
}

function detectCategory(t=""){
t=t.toLowerCase();
if(/screen|display|lcd|crack|smashed|glass/.test(t)) return "screen";
if(/battery|drain|swollen|shuts off/.test(t)) return "battery";
if(/charge|charging|charger|port|cable/.test(t)) return "charge";
if(/water|liquid|wet|dropped in/.test(t)) return "water";
if(/back glass|backglass|back cover|back.*crack/.test(t)) return "backglass";
return null;
}

function isPowerIssue(t=""){
t=t.toLowerCase();
return /(no power|not turning on|won't turn on|doesn't turn on|power issue|won t turn on|black screen)|(부팅 안|전원 안|안 켜|켜지지)/.test(t);
}

// fallback price table
const PRICE_TABLE={
screen:{priceRange:[150,280],timeRange:[30,60],difficulty:3},
battery:{priceRange:[60,120],timeRange:[20,40],difficulty:2},
charge:{priceRange:[50,120],timeRange:[20,60],difficulty:3},
water:{priceRange:[80,220],timeRange:[60,120],difficulty:4},
backglass:{priceRange:[150,260],timeRange:[90,180],difficulty:4}
};

function describeCategory(cat){
const c=PRICE_TABLE[cat]; if(!c) return null;
return {
price:`about ${c.priceRange[0]}–${c.priceRange[1]} AUD`,
time:`around ${c.timeRange[0]}–${c.timeRange[1]} minutes`,
diff: c.difficulty>=4 ? "more complex repair" : "moderate difficulty"
};
}

function findBestPrice(text,brand){
const norm=normalize(text);
let cand=PRICE_DATA.filter(r=>{
if(brand==="apple"&&!r.brand.toLowerCase().includes("apple"))return false;
if(brand==="samsung"&&!r.brand.toLowerCase().includes("samsung"))return false;
return true;
});

let best=null,score=0;
cand.forEach(r=>{
const n=normalize(r.model);
if(norm.includes(n)&&n.length>score){score=n.length;best=r;}
});
return best;
}

// ===== GPT response =====
async function generateReply(input){
const brand=detectBrand(input);
const cat=detectCategory(input);
const row=findBestPrice(input,brand);
const info=cat?describeCategory(cat):null;

if(brand==="xiaomi"||brand==="google")
return `We currently do not repair Xiaomi or Google Pixel devices. You may bring it in for a quick check.`;

if(isPowerIssue(input))
return `If the device won't power on, it may still be a battery or screen problem instead of the mainboard. We can test it in-store in about 10–20 minutes.`;

if(cat==="charge")
return `Charging issues are often fixed with a port cleaning for 20 AUD. If we find hardware damage, we do not perform charging port repairs.`;

if(brand==="other")
return `Repair price varies by model. If you tell us the exact model, we can estimate more accurately.`;

if(brand==="unknown"&&!row)
return `Could you tell me the brand and model? If unsure, bring it in and we will check it for you.`;

if(row) return `The repair for ${row.model} is around ${row.price} AUD. Final cost may vary after inspection.`;

if(info) return `Estimated cost is ${info.price}. It usually takes ${info.time}. Final quote depends on inspection.`;

return `We can assist once we know the exact model and issue. Feel free to bring the device in for a check.`;
}

// ===== Health check =====
app.get("/",(_,res)=>res.send("Bluefone AI Phone Assistant - Neural Voice Active"));

// ===== Webhook =====
app.post("/webhook", async (req,res)=>{
const twiml = new twilio.twiml.VoiceResponse();
const from=req.body.From||"";
const speech=req.body.SpeechResult;

try{

// Wife bypass → connect direct
if(from===WIFE_NUMBER){
twiml.say({voice:"neural:woman"},"Hi, connecting your call now.");
twiml.dial(OWNER_MOBILE);
return res.type("text/xml").send(twiml.toString());
}

// Bot OFF → forward to owner
if(!isBotActiveNow()){
twiml.say({voice:"neural:woman"},"Our AI is currently offline. Forwarding you now.");
twiml.dial(OWNER_MOBILE);
return res.type("text/xml").send(twiml.toString());
}

// First entry → ask for issue
if(!speech){
const g=twiml.gather({
input:"speech",
action:"/webhook",
method:"POST",
speechTimeout:"auto"
});

g.say({voice:"neural:woman"},
`Hello, this is ${SHOP_NAME}. Please tell me your phone model and the issue.`);

return res.type("text/xml").send(twiml.toString());
}

// Generate reply from GPT
const reply=await generateReply(speech);

twiml.say({voice:"neural:woman"},reply);
twiml.say({voice:"neural:woman"},"If you have more questions, you can visit our shop anytime. Thank you.");
twiml.hangup();
res.type("text/xml").send(twiml.toString());

} catch(e){
console.error(e);
twiml.say({voice:"neural:woman"},"Sorry, an error occurred. Please call again.");
twiml.hangup();
res.type("text/xml").send(twiml.toString());
}
});

// ===== Start server =====
app.listen(process.env.PORT||3000,()=>{
console.log("AI Phone Assistant with Neural Voice Running");
loadPriceData();
});