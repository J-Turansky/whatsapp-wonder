const ANDROID_LINE = /^\s*(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4}),\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]m)?\s*-\s*(.*)$/i;
const IOS_LINE = /^\s*\[(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4}),\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]m)?\s*\]\s*(.*)$/i;
const MEDIA_TEXT = /(?:<media omitted>|\b(?:image|video|audio|sticker|gif|document) omitted\b)/i;
const EDGE_MARKS = /^[\u200e\u200f]+|[\u200e\u200f]+$/g;

function resolveYear(value) {
  const year = Number(value);
  if (value.length === 4) return year;
  return year <= 49 ? 2000 + year : 1900 + year;
}

function makeDate(parts, monthFirst) {
  const first = Number(parts[1]);
  const second = Number(parts[2]);
  const day = monthFirst ? second : first;
  const month = monthFirst ? first : second;
  const year = resolveYear(parts[3]);
  let hour = Number(parts[4]);
  const minute = Number(parts[5]);
  const secondOfMinute = Number(parts[6] || 0);
  const meridiem = (parts[7] || '').toLowerCase();

  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    hour = hour % 12 + (meridiem === 'pm' ? 12 : 0);
  }
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || secondOfMinute > 59) return null;
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(hour, minute, secondOfMinute, 0);
  if (!Number.isFinite(date.getTime()) || date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

export function parseChat(text) {
  const source = String(text ?? '').replace(/^\uFEFF/, '');
  const lines = source.split(/\r?\n/);
  const parsed = [];
  let firstAboveTwelve = false;
  let secondAboveTwelve = false;
  let format = null;

  for (const rawLine of lines) {
    const line = rawLine.replace(EDGE_MARKS, '');
    let match = ANDROID_LINE.exec(line);
    let lineFormat = 'Android';
    if (!match) {
      match = IOS_LINE.exec(line);
      lineFormat = 'iOS';
    }
    if (match) {
      if (!format) format = lineFormat;
      const authorAndText = match[8];
      const separator = authorAndText.match(/^([^:\n]+): (.*)$/);
      const author = separator ? separator[1].trim() : null;
      const messageText = separator ? separator[2] : authorAndText;
      const entry = {
        dateParts: match,
        author: author || null,
        text: messageText.replace(EDGE_MARKS, ''),
        isSystem: !author,
        isMedia: MEDIA_TEXT.test(messageText.replace(/[\u200e\u200f]/g, ''))
      };
      const first = Number(match[1]);
      const second = Number(match[2]);
      if (first > 12) firstAboveTwelve = true;
      if (second > 12) secondAboveTwelve = true;
      parsed.push(entry);
    } else if (parsed.length) {
      parsed[parsed.length - 1].text += `\n${line}`;
      if (MEDIA_TEXT.test(line.replace(/[\u200e\u200f]/g, ''))) parsed[parsed.length - 1].isMedia = true;
    }
  }

  const monthFirst = secondAboveTwelve;
  const messages = [];
  let systemCount = 0;
  for (const item of parsed) {
    const date = makeDate(item.dateParts, monthFirst);
    if (!date) continue;
    messages.push({ date, author: item.author, text: item.text, isMedia: item.isMedia, isSystem: item.isSystem });
    if (item.isSystem) systemCount += 1;
  }
  const participantSet = new Set();
  let startDate = null;
  let endDate = null;
  for (const message of messages) {
    if (message.isSystem) continue;
    if (message.author) participantSet.add(message.author);
    if (!startDate || message.date < startDate) startDate = message.date;
    if (!endDate || message.date > endDate) endDate = message.date;
  }

  return { messages, participants: [...participantSet], systemCount, startDate, endDate, format };
}
