// inventory.js
// --------------------------------------------------
// Static price list for Bluefone
// Brand, Device, Model, Variant, Price (AUD)
// --------------------------------------------------

const ITEMS = [
  { brand: "Apple",   device: "iPhone", model: "16 E",             variant: "Screen",      price: 190 },
  { brand: "Apple",   device: "iPhone", model: "16 pro max",       variant: "Screen",      price: 350 },
  { brand: "Apple",   device: "iPhone", model: "16 pro",           variant: "Screen",      price: 280 },
  { brand: "Apple",   device: "iPhone", model: "16 plus",          variant: "Screen",      price: 270 },
  { brand: "Apple",   device: "iPhone", model: "16",               variant: "Screen",      price: 200 },

  { brand: "Apple",   device: "iPhone", model: "15 pro max",       variant: "Screen",      price: 300 },
  { brand: "Apple",   device: "iPhone", model: "15 pro",           variant: "Screen",      price: 300 },
  { brand: "Apple",   device: "iPhone", model: "ip 15 plus",       variant: "Screen",      price: 230 },
  { brand: "Apple",   device: "iPhone", model: "ip 15",            variant: "Screen",      price: 170 },
  { brand: "Apple",   device: "iPhone", model: "14 Pro Max",       variant: "Screen",      price: 240 },
  { brand: "Apple",   device: "iPhone", model: "14 plus",          variant: "Screen",      price: 180 },
  { brand: "Apple",   device: "iPhone", model: "14 Pro",           variant: "Screen",      price: 200 },
  { brand: "Apple",   device: "iPhone", model: "14",               variant: "Screen",      price: 150 },

  { brand: "Apple",   device: "iPhone", model: "13 Pro Max",       variant: "Screen",      price: 190 },
  { brand: "Apple",   device: "iPhone", model: "13 Pro",           variant: "Screen",      price: 180 },
  { brand: "Apple",   device: "iPhone", model: "13",               variant: "Screen",      price: 140 },
  { brand: "Apple",   device: "iPhone", model: "13 mini",          variant: "Screen",      price: 140 },

  { brand: "Apple",   device: "iPhone", model: "12 PRO MAX",       variant: "Screen",      price: 160 },
  { brand: "Apple",   device: "iPhone", model: "iPHONE 12 PRO",    variant: "Screen",      price: 130 },
  { brand: "Apple",   device: "iPhone", model: "iPHONE 12",        variant: "Screen",      price: 130 },
  { brand: "Apple",   device: "iPhone", model: "iPHONE 12 Mini",   variant: "Screen",      price: 130 },

  { brand: "Apple",   device: "iPhone", model: "iPHONE 11 PRO MAX",variant: "Screen",      price: 140 },
  { brand: "Apple",   device: "iPhone", model: "iPHONE 11 PRO",    variant: "Screen",      price: 130 },
  { brand: "Apple",   device: "iPhone", model: "iPHONE 11",        variant: "Screen",      price: 120 },

  { brand: "Apple",   device: "iPhone", model: "iPHONE XS MAX",    variant: "Screen",      price: 120 },
  { brand: "Apple",   device: "iPhone", model: "iPHONE X",         variant: "Screen",      price: 100 },
  { brand: "Apple",   device: "iPhone", model: "iPHONE XS",        variant: "Screen",      price: 100 },
  { brand: "Apple",   device: "iPhone", model: "iPHONE XR",        variant: "Screen",      price: 100 },
  { brand: "Apple",   device: "iPhone", model: "iPHONE 8 PLUS",    variant: "Screen",      price: 110 },
  { brand: "Apple",   device: "iPhone", model: "iPHONE 8/SE",      variant: "Screen",      price: 100 },
  { brand: "Apple",   device: "iPhone", model: "iPHONE 7 PLUS",    variant: "Screen",      price: 100 },
  { brand: "Apple",   device: "iPhone", model: "iPHONE 7",         variant: "Screen",      price: 100 },

  { brand: "Samsung", device: "GALAXY", model: "GALAXY S24 ULTRA", variant: "Screen",      price: 520 },
  { brand: "Samsung", device: "GALAXY", model: "GALAXY S24 PLUS",  variant: "Screen",      price: 450 },
  { brand: "Samsung", device: "GALAXY", model: "GALAXY S24",       variant: "Screen",      price: 360 },
  { brand: "Samsung", device: "GALAXY", model: "GALAXY S24 FE",    variant: "Screen",      price: 300 },
  { brand: "Samsung", device: "GALAXY", model: "GALAXY S23 ULTRA", variant: "Screen",      price: 470 },
  { brand: "Samsung", device: "GALAXY", model: "GALAXY S23 PLUS",  variant: "Screen",      price: 360 },
  { brand: "Samsung", device: "GALAXY", model: "GALAXY S23",       variant: "Screen",      price: 360 },
  { brand: "Samsung", device: "GALAXY", model: "GALAXY S23 FE",    variant: "Screen",      price: 300 },

  { brand: "Samsung", device: "GALAXY", model: "GALAXY S22 ULTRA", variant: "Screen",      price: 470 },
  { brand: "Samsung", device: "GALAXY", model: "GALAXY S22 PLUS",  variant: "Screen",      price: 330 },
  { brand: "Samsung", device: "GALAXY", model: "GALAXY S22",       variant: "Screen",      price: 370 },
  { brand: "Samsung", device: "GALAXY", model: "GALAXY S21 ULTRA", variant: "Screen",      price: 450 },
  { brand: "Samsung", device: "GALAXY", model: "GALAXY S21 PLUS",  variant: "Screen",      price: 380 },
  { brand: "Samsung", device: "GALAXY", model: "GALAXY S21",       variant: "Screen",      price: 330 },
  { brand: "Samsung", device: "GALAXY", model: "GALAXY S21 FE",    variant: "Screen",      price: 300 },
  { brand: "Samsung", device: "GALAXY", model: "GALAXY S20 ULTRA", variant: "Screen",      price: 390 },
  { brand: "Samsung", device: "GALAXY", model: "GALAXY S20 PLUS",  variant: "Screen",      price: 390 },
  { brand: "Samsung", device: "GALAXY", model: "GALAXY S20",       variant: "Screen",      price: 370 },
  { brand: "Samsung", device: "GALAXY", model: "GALAXY S20 FE",    variant: "Screen",      price: 280 },

  { brand: "Apple",   device: "IPAD",   model: "5th gen",          variant: "Front glass", price: 130 },
  { brand: "Apple",   device: "IPAD",   model: "6th gen",          variant: "Front glass", price: 130 },
  { brand: "Apple",   device: "IPAD",   model: "7th gen",          variant: "Front glass", price: 140 },
  { brand: "Apple",   device: "IPAD",   model: "8th gen",          variant: "Front glass", price: 140 },
  { brand: "Apple",   device: "IPAD",   model: "9th gen",          variant: "Front glass", price: 140 },
  { brand: "Apple",   device: "IPAD",   model: "10th gen",         variant: "Front glass", price: 150 },

  { brand: "Apple",   device: "IPAD",   model: "5th gen",          variant: "LCD",         price: 220 },
  { brand: "Apple",   device: "IPAD",   model: "6th gen",          variant: "LCD",         price: 230 },
  { brand: "Apple",   device: "IPAD",   model: "7th gen",          variant: "LCD",         price: 230 },
  { brand: "Apple",   device: "IPAD",   model: "8th gen",          variant: "LCD",         price: 230 },
  { brand: "Apple",   device: "IPAD",   model: "9th gen",          variant: "LCD",         price: 230 },
  { brand: "Apple",   device: "IPAD",   model: "10th gen",         variant: "LCD",         price: 380 }
];

// 간단한 정규화 (iPhone / Galaxy / 공백 제거 등)
function normalize(text = "") {
  return text
    .toLowerCase()
    .replace(/apple|iphone|ipad|samsung|galaxy|screen|front glass|lcd/g, "")
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9+]/g, "");
}

// 통화 내용(문장)이나 모델명을 넣으면 가장 잘 맞는 항목을 리턴
function findPrice(query) {
  if (!query) return null;
  const q = normalize(query);
  let best = null;
  let bestScore = 0;

  for (const row of ITEMS) {
    const target = normalize(`${row.device} ${row.model} ${row.variant}`);
    if (!target) continue;

    if (q.includes(target) || target.includes(q)) {
      const score = target.length;
      if (score > bestScore) {
        bestScore = score;
        best = row;
      }
    }
  }
  return best; // {brand, device, model, variant, price} 또는 null
}

module.exports = { ITEMS, findPrice };