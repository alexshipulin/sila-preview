/**
 * The owner hears about every paid order in Telegram.
 *
 * Plain text, no parse_mode: a buyer's comment with an underscore or an
 * asterisk would make Telegram reject a Markdown message on every retry, and
 * the order would never be announced.
 */
const { LEAD_DAYS } = require('./order');

const DAY = 86400;

/** "23 окт." — counted from payment, read on Bali time, where the workshop is. */
function dueDate(createdSeconds) {
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', timeZone: 'Asia/Makassar' })
    .format(new Date((createdSeconds + LEAD_DAYS * DAY) * 1000));
}

function money(amount) {
  return `$${(amount / 100).toFixed(amount % 100 ? 2 : 0)}`;
}

/** outcome: 'decremented' | 'converted' | 'made' — see webhook.applyPaid */
function orderMessage(meta, outcome, amount, createdSeconds) {
  const made = outcome !== 'decremented';
  const lines = [
    `Новый заказ ${meta.order_id}`,
    `${meta.model} · US ${meta.size_us}`,
    made ? `Под заказ · сделать к ${dueDate(createdSeconds)}` : 'Из наличия',
  ];
  if (outcome === 'converted') {
    lines.push('⚠️ Последнее кольцо этого размера секундой раньше купил другой покупатель. '
      + 'Предложите изготовление (~15 дней) или полный возврат.');
  }
  lines.push('', `Имя: ${meta.name}`, `WhatsApp: ${meta.whatsapp}`);
  if (meta.comment) lines.push(`Комментарий: ${meta.comment}`);
  lines.push('', `Оплачено ${money(amount)}`);
  return lines.join('\n');
}

/**
 * Sends one message. Resolves true when Telegram took it and 'failed' when
 * Telegram refused it for good (a 4xx: wrong token, wrong chat, blocked bot) —
 * retrying that would never succeed. A network error, a 429 or a 5xx throws,
 * so the webhook answers 500 and Stripe redelivers later.
 */
async function sendTelegram(token, chatId, text, fetchImpl = fetch) {
  const res = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    signal: AbortSignal.timeout(5000),
  });
  if (res.ok) return true;
  if (res.status === 429 || res.status >= 500) throw new Error(`Telegram answered ${res.status}`);
  return 'failed';
}

module.exports = { orderMessage, sendTelegram, dueDate, money };
