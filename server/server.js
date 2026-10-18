// Сервер приёма заявок: сайт -> этот сервер -> Telegram.
// Без внешних библиотек. Нужен Node.js 20.6 или новее.
// Запуск: node --env-file=.env server.js

const http = require("http");

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const PORT = process.env.PORT || 3000;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*"; // потом укажите адрес вашего сайта

if (!TOKEN || !CHAT_ID) {
  console.error("Не заданы TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID. Проверьте файл .env");
  process.exit(1);
}

// Telegram в режиме HTML требует экранировать эти символы
const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const CAT_NAMES = { dental: "Стоматология", cleaning: "Клининг" };

function formatBooking(b) {
  const urgent = b.symptoms && b.symptoms.urgent;
  const lines = [];
  lines.push(urgent ? "🚨 <b>СРОЧНАЯ ЗАЯВКА</b>" : "🆕 <b>Новая заявка</b>");
  lines.push("");
  lines.push("<b>Направление:</b> " + esc(CAT_NAMES[b.cat] || b.cat));
  lines.push("<b>Услуга:</b> " + esc(b.serviceName));
  lines.push("<b>Когда:</b> " + esc(b.date) + ", " + esc(b.time));
  if (b.price) lines.push("<b>Стоимость:</b> " + esc(b.price));
  lines.push("");
  lines.push("<b>Клиент:</b> " + esc(b.name));
  lines.push("<b>Телефон:</b> " + esc(b.phone));
  if (b.address) lines.push("<b>Адрес:</b> " + esc(b.address));
  if (b.area) lines.push("<b>Площадь:</b> " + esc(b.area) + " м²");

  // Блок симптомов (появится после добавления формы про зубную боль на сайте)
  if (b.symptoms) {
    const s = b.symptoms;
    lines.push("");
    lines.push("<b>Что беспокоит:</b> " + esc(s.complaint || "не указано"));
    if (s.painLevel != null) lines.push("<b>Сила боли:</b> " + esc(s.painLevel) + "/10");
    if (s.duration) lines.push("<b>Как давно:</b> " + esc(s.duration));
    if (s.zone) lines.push("<b>Зона:</b> " + esc(s.zone));
    if (s.swelling) lines.push("⚠️ Есть отёк");
    if (s.fever) lines.push("⚠️ Есть температура");
  }
  if (b.note) { lines.push(""); lines.push("<b>Комментарий:</b> " + esc(b.note)); }
  return lines.join("\n");
}

async function sendToTelegram(text) {
  const res = await fetch("https://api.telegram.org/bot" + TOKEN + "/sendMessage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: "HTML" })
  });
  const data = await res.json();
  if (!data.ok) throw new Error("Telegram: " + (data.description || res.status));
}

// Простая защита от спама: не больше 10 заявок в час с одного адреса
const hits = new Map();
function limited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter(t => now - t < 3600e3);
  list.push(now); hits.set(ip, list);
  return list.length > 10;
}

function reply(res, code, obj) {
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  res.end(JSON.stringify(obj));
}

http.createServer((req, res) => {
  if (req.method === "OPTIONS") return reply(res, 204, {});
  if (req.method === "GET" && req.url === "/health") return reply(res, 200, { ok: true });

  if (req.method === "POST" && req.url === "/api/bookings") {
    const ip = req.socket.remoteAddress;
    if (limited(ip)) return reply(res, 429, { ok: false, error: "Слишком много заявок" });

    let body = "";
    req.on("data", chunk => { body += chunk; if (body.length > 20000) req.destroy(); });
    req.on("end", async () => {
      let b;
      try { b = JSON.parse(body); } catch { return reply(res, 400, { ok: false, error: "Неверный формат" }); }
      if (!b.name || !b.phone || !b.serviceName || !b.date || !b.time) {
        return reply(res, 400, { ok: false, error: "Не хватает данных" });
      }
      try {
        await sendToTelegram(formatBooking(b));
        console.log("Заявка отправлена в Telegram:", b.id);
        reply(res, 200, { ok: true, id: b.id });
      } catch (err) {
        console.error(err.message);
        reply(res, 502, { ok: false, error: "Не удалось отправить уведомление" });
      }
    });
    return;
  }
  reply(res, 404, { ok: false, error: "Не найдено" });
}).listen(PORT, () => console.log("Сервер запущен: http://localhost:" + PORT));
