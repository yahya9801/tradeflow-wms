export const COMMODITIES = [
  { name: "Long Grain Rice", hs_code: "1006.30", category: "Grains", market_price_per_mt: 620, bag_weight_kg: 50 },
  { name: "Basmati Rice", hs_code: "1006.30", category: "Grains", market_price_per_mt: 1150, bag_weight_kg: 25 },
  { name: "Milling Wheat", hs_code: "1001.99", category: "Grains", market_price_per_mt: 280, bag_weight_kg: 50 },
  { name: "White Sugar", hs_code: "1701.99", category: "Sweeteners", market_price_per_mt: 540, bag_weight_kg: 50 },
  { name: "Yellow Maize", hs_code: "1005.90", category: "Grains", market_price_per_mt: 240, bag_weight_kg: 50 },
  { name: "Soybean", hs_code: "1201.90", category: "Oilseeds", market_price_per_mt: 480, bag_weight_kg: 50 },
  { name: "Chickpeas", hs_code: "0713.20", category: "Pulses", market_price_per_mt: 900, bag_weight_kg: 25 },
  { name: "Green Lentils", hs_code: "0713.40", category: "Pulses", market_price_per_mt: 780, bag_weight_kg: 25 },
  { name: "Arabica Coffee", hs_code: "0901.11", category: "Soft Commodities", market_price_per_mt: 4200, bag_weight_kg: 60 },
  { name: "Raw Cotton", hs_code: "5201.00", category: "Fibres", market_price_per_mt: 1700, bag_weight_kg: 225 },
] as const;

export const COUNTRIES = ["India", "Vietnam", "Thailand", "Brazil", "USA", "Ukraine", "Pakistan", "Argentina", "Ethiopia", "Australia"];
export const CURRENCIES = ["USD", "EUR", "GBP", "AED"];
export const LOT_STATUSES = ["pending", "in_transit", "received", "stored", "dispatched", "delivered"] as const;
