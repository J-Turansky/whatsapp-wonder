const ANDROID_LINE = /^\s*(\d{1,2})[/ .\-](\d{1,2})[/ .\-](\d{2,4}),\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]m)?\s*-\s*(.*)$/i;
const IOS_LINE = /^\s*\[(\d{1,2})[/ .\-](\d{1,2})[/ .\-](\d{2,4}),\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]m)?\s*\]\s*(.*)$/i;
const DATE_LIKE = /^\s*(?:\[)?\d{1,2}[/ .\-]\d{1,2}[/ .\-]\d{2,4},\s*\d{1,2}:\d{2}/;
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
  if (month < 1 || month > 12 || day < 1 || hour < 0 || hour > 23 || minute > 59 || secondOfMinute > 59) return null;
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(hour, minute, secondOfMinute, 0);
  if (!Number.isFinite(date.getTime()) || date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}
function buildInterpretation(entries, monthFirst) {
  const messages = [];
  let skippedLines = 0;
  let systemCount = 0;
  let current = null;
  for (const item of entries) {
    if (item.kind === 'invalid') {
      skippedLines += 1;
      current = null;
    } else if (item.kind === 'entry') {
      const date = makeDate(item.match, monthFirst);
      if (!date) {
        skippedLines += 1;
        current = null;
        continue;
      }
      const authorAndText = item.match[8];
      const separator = authorAndText.match(/^([^:\n]+):\s(.*)$/);
      const author = separator ? separator[1].trim() : null;
      const text = (separator ? separator[2] : authorAndText).replace(EDGE_MARKS, '');
      current = { date, author: author || null, text, isSystem: !author, isMedia: MEDIA_TEXT.test(text.replace(/[\u200e\u200f]/g, '')), exportOrder: item.lineIndex };
      messages.push(current);
      if (current.isSystem) systemCount += 1;
    } else if (item.kind === 'continuation') {
      if (current) {
        current.text += `\n${item.line}`;
        if (MEDIA_TEXT.test(item.line.replace(/[\u200e\u200f]/g, ''))) current.isMedia = true;
      } else if (item.line.trim()) skippedLines += 1;
    }
  }
  const authored = messages.filter((message) => !message.isSystem);
  const participants = [...new Set(authored.map((message) => message.author).filter(Boolean))];
  const dates = authored.map((message) => message.date).sort((a, b) => a - b);
  return {
    messages, participants, systemCount, skippedLines, authoredCount: authored.length,
    startDate: dates[0] || null, endDate: dates[dates.length - 1] || null
  };
}
export function parseChat(text, selectedOrder = null) {
  const source = String(text ?? '').replace(/^\uFEFF/, '').replace(/[\u200e\u200f]/g, '').replace(/[\u202f\u00a0]/g, ' ');
  const lines = source.split(/\r?\n/);
  const entries = [];
  let format = null;
  const decisive = new Set();
  const previews = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].replace(EDGE_MARKS, '');
    let match = ANDROID_LINE.exec(line);
    let lineFormat = 'Android';
    if (!match) { match = IOS_LINE.exec(line); lineFormat = 'iOS'; }
    if (match) {
      if (!format) format = lineFormat;
      entries.push({ kind: 'entry', match, lineIndex: index });
      const dayFirst = makeDate(match, false);
      const monthFirst = makeDate(match, true);
      if (dayFirst && !monthFirst) decisive.add('day-first');
      if (monthFirst && !dayFirst) decisive.add('month-first');
      if (previews.length < 2 && dayFirst && monthFirst && dayFirst.getTime() !== monthFirst.getTime()) {
        previews.push({ original: `${match[1]}/${match[2]}/${match[3]}, ${match[4]}:${match[5]}${match[6] ? `:${match[6]}` : ""}`, dayFirst, monthFirst });
      }
    } else if (line.trim()) {
      entries.push({ kind: DATE_LIKE.test(line) ? 'invalid' : 'continuation', line, lineIndex: index });
    }
  }
  const conflict = decisive.size > 1;
  const ambiguous = !conflict && decisive.size === 0 && previews.length > 0;
  let dateOrder = selectedOrder || (decisive.has('month-first') ? 'month-first' : 'day-first');
  const interpretation = buildInterpretation(entries, dateOrder === 'month-first');
  if (!selectedOrder && ambiguous) dateOrder = null;
  return {
    ...interpretation, format, dateOrder, dateStatus: conflict ? 'conflict' : ambiguous && !selectedOrder ? 'ambiguous' : selectedOrder ? 'selected' : 'inferred',
    previews: previews.map(({ original, dayFirst, monthFirst }) => ({ original, dayFirst, monthFirst })),
    quality: { authoredMessages: interpretation.authoredCount, systemEntries: interpretation.systemCount, skippedLines: interpretation.skippedLines }
  };
}
