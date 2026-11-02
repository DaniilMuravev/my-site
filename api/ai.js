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

function request(url, { method = "POST", headers = {}, body, timeout = 25000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method, headers, agent }, res => {
      const chunks = []; res.on("data", c => chunks.push(c));
      res.on("end", () => { const buf = Buffer.concat(chunks); resolve({ status: res.statusCode, text: buf.toString("utf8"), buf, type: res.headers["content-type"] || "" }); });
    });
    req.on("error", reject);
    req.setTimeout(timeout, () => req.destroy(new Error("timeout")));
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
const styleFor = (uncensored) => `Пиши по-русски, разговорно и смешно, как стендап-комик из интернета 2026 года. Используй свежие мемы уместно, не больше одного-двух в строке: ${MEMES}. Каждая шутка опирается на конкретную цифру и интерпретирует ее: что это говорит о людях, а не просто повторяет число. ${uncensored ? "Можно мат, умеренно и смешно, как в дружеском чате, например «вот такая хуйня, собачка». Без оскорблений людей по признакам." : "Без мата."} Без политики, тем внешности и личной жизни. Не используй букву ё. Без длинных тире. Внутри текстовых значений никогда не используй двойные кавычки, только «елочки».`;

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
{"arch":"архетип канала, 2-3 слова","archLine":"одна смешная строка про архетип","red":["6 разных ред флагов, каждый с цифрой"],"green":["4 грин флага с цифрой"],"pov":["3 разные строки, каждая начинается с POV:"],"memes":[{"format":"nobody","top":"Никто:","bottom":"смешная концовка про канал"},{"format":"expect","top":"Ожидание: ...","bottom":"Реальность: ..."},{"format":"vs","top":"Подписчики: ...","bottom":"Канал: ..."}],"tips":["4 коротких полезных совета"],"outro":"короткая финальная фраза"${data.facts && data.facts.post_snippets ? `,"post_roasts":[{"quote":"начало поста из post_snippets, до 60 символов","roast":"острая шутка именно про этот пост"}]` : ""}}
${data.facts && data.facts.post_snippets ? "В post_roasts разбери 3 разных поста из post_snippets." : ""}`;
  }
  if (kind === "recap") {
    const f = data.facts || {}, ov = f.mode === "overview";
    return `Ты пишешь подписи к итогам года переписки в Telegram в формате сторис. ${STYLE}
Пиши коротко: каждая строка до 140 символов. Интерпретируй цифры, говори, что они значат про людей. Не пересказывай число без смысла. Сравнение для книги каждый раз придумывай новое и неожиданное.
Данные (JSON): ${JSON.stringify(f).slice(0, 7000)}
Верни только JSON без пояснений и без markdown:
{"intro":"строка про общий объем",${ov ? "" : '"writers":"строка про то, кто больше пишет",'}"rhythm":"строка про ритм и самый жаркий день","timeTitle":"название для самого активного времени, 2-4 слова","timeLine":"строка про это время","book":"строка с неожиданным сравнением объема текста в современных единицах: экраны телефона, рилсы, посты, часы печати","words":"строка про слова года и фразу","emoji":"строка про эмодзи","age":"строка про возраст чата","verdict":"финальная фраза, до 60 символов",${ov ? '"roles":[{"t":"название роли","who":"имя из roles","d":"смешное пояснение с цифрой"}]' : '"awards":[{"t":"номинация","who":"имя из people","d":"пояснение с цифрой"}]'}}
${ov ? "Роли бери из данных roles, имена не меняй, перепиши только названия и пояснения смешнее." : "Номинаций 5, имена только из people."}`;
  }
  if (kind === "nominations") {
    return `Ты придумываешь смешные номинации к итогам года переписки в Telegram по статистике. ${STYLE}
Данные (JSON): ${JSON.stringify(data.facts).slice(0, 6000)}
Верни только JSON без пояснений и без markdown: {"title":"заголовок до 5 слов","verdict":"одна смешная фраза про чат","nominations":[{"t":"номинация","who":"имя из данных","d":"пояснение с цифрой"}]}. 4-5 номинаций, имена только из данных.`;
  }
  return null;
}

function repairJson(t) {
  t = t.replace(/```json|```/g, "").replace(/[“”„]/g, '"').trim();
  t = t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1);
  let out = "", inStr = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === "\\") { out += c + (t[i + 1] || ""); i++; continue; }
    if (c === '"') {
      if (!inStr) { inStr = true; out += c; continue; }
      const rest = t.slice(i + 1).match(/^\s*(.)/);
      if (!rest || /[,:}\]]/.test(rest[1])) { inStr = false; out += c; } else out += '\\"';
      continue;
    }
    if (inStr && (c === "\n" || c === "\r")) { out += " "; continue; }
    out += c;
  }
  return out.replace(/,\s*([}\]])/g, "$1");
}
function parseJson(text) {
  try { const c = text.replace(/```json|```/g, "").trim(); return JSON.parse(c.slice(c.indexOf("{"), c.lastIndexOf("}") + 1)); }
  catch (e) { return JSON.parse(repairJson(text)); }
}

const API_BASE = API_URL.replace(/\/chat\/completions$/, "");
function imagePrompt(data) {
  const f = data.facts || {}, who = { guy: "парень", girl: "девушка", pair: "двое друзей" }[data.who];
  const time = f.peak_hour < 5 ? "глубокая ночь" : f.peak_hour < 12 ? "утро" : f.peak_hour < 18 ? "день" : "вечер";
  return `Нарисуй минималистичную иллюстрацию-постер про переписку в мессенджере. ${who ? `На картинке ${who}, стилизованно, без лица крупным планом.` : "Без людей, только предметы и настроение."} Время: ${time}. Настроение и детали по словам: ${(f.top_words || []).slice(0, 6).join(", ")}. Стиль: тонкие белые контурные линии на глубоком темно-изумрудном фоне, латунные акценты, много воздуха, современный японский минимализм. Без текста и букв на изображении.`;
}
async function generateImage(data, token) {
  const r = await request(API_URL, {
    headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify({ model: MODEL, function_call: "auto", messages: [{ role: "system", content: "Ты художник-иллюстратор" }, { role: "user", content: imagePrompt(data) }] }),
    timeout: 50000,
  });
  if (r.status !== 200) return { error: "image_unavailable", detail: r.status };
  const content = JSON.parse(r.text).choices?.[0]?.message?.content || "";
  const m = content.match(/<img[^>]+src="([^"]+)"/);
  if (!m) return { error: "image_unavailable", detail: "no image in answer" };
  const f = await request(`${API_BASE}/files/${m[1]}/content`, { method: "GET", headers: { Accept: "application/jpg", Authorization: "Bearer " + token }, timeout: 8000 });
  if (f.status !== 200) return { error: "image_unavailable", detail: "file " + f.status };
  return { image: "data:image/jpeg;base64," + f.buf.toString("base64") };
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    if (!(req.query && req.query.check)) return res.status(200).json({ ok: !!process.env.GIGACHAT_AUTH_KEY });
    const out = { key: !!process.env.GIGACHAT_AUTH_KEY, oauth: false, chat: false };
    try { const t = await getToken(); out.oauth = true;
      const r = await request(API_URL, { headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: "Bearer " + t }, body: JSON.stringify({ model: MODEL, max_tokens: 20, messages: [{ role: "user", content: "Скажи привет" }] }) });
      out.chat = r.status === 200; out.chat_status = r.status; if (r.status !== 200) out.chat_detail = r.text.slice(0, 300);
    } catch (e) { out.error = String(e.message || e).slice(0, 300); }
    return res.status(200).json(out);
  }
  if (req.method !== "POST") return res.status(405).end();
  if (!process.env.GIGACHAT_AUTH_KEY) return res.status(503).json({ error: "no key" });

  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0] || "x";
  const now = Date.now(), list = (hits.get(ip) || []).filter(t => now - t < 60000);
  if (list.length >= 10) return res.status(429).json({ error: "slow down" });
  list.push(now); hits.set(ip, list);

  try {
    const { kind, data } = req.body || {};
    if (kind === "image") {
      const token = await getToken();
      const out = await generateImage(data || {}, token);
      return res.status(out.image ? 200 : 502).json(out);
    }
    const prompt = buildPrompt(kind, data || {});
    if (!prompt) return res.status(400).json({ error: "bad kind" });
    const token = await getToken();
    const r = await request(API_URL, {
      headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify({ model: MODEL, temperature: 0.85, max_tokens: 1400, messages: [{ role: "user", content: prompt }] }),
      timeout: 45000,
    });
    if (r.status === 429) return res.status(429).json({ error: "gigachat busy" });
    if (r.status !== 200) return res.status(502).json({ error: "gigachat " + r.status });
    const content = JSON.parse(r.text).choices?.[0]?.message?.content || "";
    try { return res.status(200).json(parseJson(content)); }
    catch (e) {
      const r2 = await request(API_URL, { headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({ model: MODEL, temperature: 0.2, max_tokens: 1400, messages: [{ role: "user", content: "Исправь JSON, чтобы он был валидным. Внутри строк замени двойные кавычки на «». Верни только JSON:\n" + content }] }) });
      const c2 = JSON.parse(r2.text).choices?.[0]?.message?.content || "";
      return res.status(200).json(parseJson(c2));
    }
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e).slice(0, 200) });
  }
}
