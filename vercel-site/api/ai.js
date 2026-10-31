// Серверная функция Vercel: принимает только цифры статистики, сама собирает промпт и спрашивает GigaChat.
// Ключ хранится в переменных окружения Vercel, в браузер он не попадает.
import https from "node:https";
import crypto from "node:crypto";

const OAUTH_URL = process.env.GIGACHAT_OAUTH_URL || "https://ngw.devices.sberbank.ru:9443/api/v2/oauth";
const API_URL   = process.env.GIGACHAT_API_URL   || "https://gigachat.devices.sberbank.ru/api/v1/chat/completions";
const SCOPE     = process.env.GIGACHAT_SCOPE     || "GIGACHAT_API_PERS";
const MODEL     = process.env.GIGACHAT_MODEL     || "GigaChat-2-Pro";
// У GigaChat сертификат российского УЦ. Пока не подключен корневой сертификат Минцифры, проверку отключаем.
const agent = new https.Agent({ rejectUnauthorized: process.env.GIGACHAT_STRICT_TLS === "1" });

let tokenCache = { token: null, exp: 0 };
const hits = new Map(); // простой лимит: 10 запросов в минуту на IP

function request(url, { method = "POST", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method, headers, agent }, res => {
      let data = ""; res.on("data", c => (data += c));
      res.on("end", () => resolve({ status: res.statusCode, text: data }));
    });
    req.on("error", reject);
    req.setTimeout(25000, () => req.destroy(new Error("timeout")));
    if (body) req.write(body);
    req.end();
  });
}

async function getToken() {
  if (tokenCache.token && Date.now() < tokenCache.exp - 60000) return tokenCache.token;
  const r = await request(OAUTH_URL, {
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json",
      RqUID: crypto.randomUUID(), Authorization: "Basic " + process.env.GIGACHAT_AUTH_KEY },
    body: "scope=" + SCOPE,
  });
  if (r.status !== 200) throw new Error("oauth " + r.status + " " + r.text.slice(0, 200));
  const j = JSON.parse(r.text);
  tokenCache = { token: j.access_token, exp: j.expires_at || Date.now() + 25 * 60000 };
  return tokenCache.token;
}

const MEMES = "«6-7» (сикс-севен), «Окак», «Можно, а зачем?», «тихо, спокойно, без суеты», «Сообщение не доставлено», Тралалело Тралала, Сахур, брейнрот, аура, база, кринж, имба, ризз, НПЦ, «вряд ли» (синица), «сидим с бобром за столом», POV, ред флаг, грин флаг, вайб, постирония в стиле «конь стоит под дождем. Почему»";
const styleFor = (uncensored) => `Пиши по-русски, разговорно и смешно, как стендап-комик из интернета 2026 года. Используй свежие мемы уместно, не больше одного-двух в строке: ${MEMES}. Каждая шутка опирается на конкретную цифру и интерпретирует ее: что это говорит о людях, а не просто повторяет число. ${uncensored ? "Можно мат, умеренно и смешно, как в дружеском чате, например «вот такая хуйня, собачка». Без оскорблений людей по признакам." : "Без мата."} Без политики, тем внешности и личной жизни. Не используй букву ё. Без длинных тире.`;

function buildPrompt(kind, data) {
  const STYLE = styleFor(!!data.uncensored);
  if (kind === "roast") {
    const hard = !!data.hard;
    const ANGLES = ["как сводка погоды","как спортивный комментатор","как ревью ресторана","как отчет инспектора ГИБДД","как фидбек от HR после собеса","как гороскоп","как диктор новостей","как тренер по фитнесу","как риелтор, который показывает квартиру","как ведущий кулинарного шоу","как сомелье","как рекламщик из 2007"];
    const angle = ANGLES.includes(data.angle) ? data.angle : ANGLES[Math.floor(Math.random() * ANGLES.length)];
    return `Ты делаешь прожарку Telegram-канала по его статистике. ${STYLE}
Режим: ${hard ? "без жалости, остро, но по-доброму" : "легкая прожарка, дружелюбно"}.
Подача: шути ${angle}. Держи этот образ во всех строках.
Не повторяй очевидные заготовки, каждая строка должна быть про другую цифру.
Данные канала (JSON): ${JSON.stringify(data.facts).slice(0, 7000)}
Верни только JSON без пояснений и без markdown:
{"arch":"архетип канала, 2-3 слова","archLine":"одна смешная строка про архетип","red":["6 разных ред флагов, каждый с цифрой"],"green":["4 грин флага с цифрой"],"pov":["3 разные строки, каждая начинается с POV:"],"memes":[{"format":"nobody","top":"Никто:","bottom":"смешная концовка про канал"},{"format":"expect","top":"Ожидание: ...","bottom":"Реальность: ..."},{"format":"vs","top":"Подписчики: ...","bottom":"Канал: ..."}],"tips":["4 коротких полезных совета"],"outro":"короткая финальная фраза"}`;
  }
  if (kind === "nominations") {
    return `Ты придумываешь смешные номинации к итогам года переписки в Telegram по статистике. ${STYLE}
Данные (JSON): ${JSON.stringify(data.facts).slice(0, 6000)}
Верни только JSON без пояснений и без markdown: {"title":"заголовок до 5 слов","verdict":"одна смешная фраза про чат","nominations":[{"t":"номинация","who":"имя из данных","d":"пояснение с цифрой"}]}. 4-5 номинаций, имена только из данных.`;
  }
  return null;
}

function parseJson(text) {
  const clean = text.replace(/```json|```/g, "").trim();
  const start = clean.indexOf("{"), end = clean.lastIndexOf("}");
  return JSON.parse(clean.slice(start, end + 1));
}

export default async function handler(req, res) {
  if (req.method === "GET") return res.status(200).json({ ok: !!process.env.GIGACHAT_AUTH_KEY });
  if (req.method !== "POST") return res.status(405).end();
  if (!process.env.GIGACHAT_AUTH_KEY) return res.status(503).json({ error: "no key" });

  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0] || "x";
  const now = Date.now(), list = (hits.get(ip) || []).filter(t => now - t < 60000);
  if (list.length >= 10) return res.status(429).json({ error: "slow down" });
  list.push(now); hits.set(ip, list);

  try {
    const { kind, data } = req.body || {};
    const prompt = buildPrompt(kind, data || {});
    if (!prompt) return res.status(400).json({ error: "bad kind" });
    const token = await getToken();
    const r = await request(API_URL, {
      headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify({ model: MODEL, temperature: 1.0, max_tokens: 1400, messages: [{ role: "user", content: prompt }] }),
    });
    if (r.status === 429) return res.status(429).json({ error: "gigachat busy" });
    if (r.status !== 200) return res.status(502).json({ error: "gigachat " + r.status });
    const content = JSON.parse(r.text).choices?.[0]?.message?.content || "";
    return res.status(200).json(parseJson(content));
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e).slice(0, 200) });
  }
}
