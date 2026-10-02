// Fixed English stopword list used only for the top-word ranking.
const STOPWORDS = new Set("a an and are as at be but by can do for from had has have he her i in is it me my no not of on or she so that the their them they this to was we were with you your".split(" "));
const SESSION_GAP_MS = 6 * 60 * 60 * 1000;
const WORD_PATTERN = /[\p{L}](?:[\p{L}\p{M}])*(?:['’][\p{L}](?:[\p{L}\p{M}])*)*/gu;
const URL_PATTERN = /\b(?:[a-z][a-z\d+.-]*:\/\/|www\.)[^\s]+|\b(?:[\p{L}\p{N}-]+\.)+[\p{L}]{2,}(?:\/[^\s]*)?/giu;
const EMOJI_PATTERN = /\p{Extended_Pictographic}|\p{Emoji_Presentation}|\p{Regional_Indicator}|\u20e3/u;
const GRAPHEME_SEGMENTER = typeof Intl.Segmenter === "function"
  ? new Intl.Segmenter("en", { granularity: "grapheme" })
  : null;

function compareText(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
function compareNames(a, b) {
  return compareText(a.toLowerCase(), b.toLowerCase()) || compareText(a, b);
}
function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function monthKey(date) { return dateKey(date).slice(0, 7); }
function localDayNumber(date) { return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000); }
function dateFromKey(key) {
  const [year, month, day = 1] = key.split("-").map(Number);
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(0, 0, 0, 0);
  return date;
}
function formatDate(date) {
  return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
}
function formatMonth(date) { return date.toLocaleDateString("en-GB", { month: "long", year: "numeric" }); }
function authoredMessages(chat) {
  return chat.messages.map((message, exportOrder) => ({ ...message, exportOrder: message.exportOrder ?? exportOrder }))
    .filter((message) => !message.isSystem && message.author)
    .sort((a, b) => a.date.getTime() - b.date.getTime() || a.exportOrder - b.exportOrder);
}
function wordsIn(text) {
  return (text.match(WORD_PATTERN) || []).map((word) => word.toLowerCase().normalize("NFC"));
}
function emojiIn(text) {
  if (!GRAPHEME_SEGMENTER) return null;
  return [...GRAPHEME_SEGMENTER.segment(text)].map(({ segment }) => segment).filter((segment) => EMOJI_PATTERN.test(segment));
}
function rankCounts(counts, limit = Infinity) {
  return [...counts].map(([item, count]) => ({ item, count }))
    .sort((a, b) => b.count - a.count || compareText(a.item, b.item)).slice(0, limit);
}
function chooseWinner(counts) {
  const sorted = [...counts].filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1] || compareNames(a[0], b[0]));
  return sorted[0] ? { name: sorted[0][0], metric: sorted[0][1] } : null;
}

function calculateStats(messages) {
  const participants = new Map();
  const words = new Map();
  const emojis = new Map();
  const hourly = Array.from({ length: 24 }, (_, hour) => ({ label: String(hour).padStart(2, "0"), count: 0 }));
  const dayNames = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const weekdays = dayNames.map((label) => ({ label, count: 0 }));
  let totalWords = 0;
  let totalMedia = 0;
  messages.forEach((message) => {
    if (!participants.has(message.author)) participants.set(message.author, { name: message.author, messages: 0, words: 0, media: 0 });
    const person = participants.get(message.author);
    person.messages += 1;
    hourly[message.date.getHours()].count += 1;
    weekdays[(message.date.getDay() + 6) % 7].count += 1;
    if (message.isMedia) {
      person.media += 1;
      totalMedia += 1;
      return;
    }
    const tokens = wordsIn(message.text);
    person.words += tokens.length;
    totalWords += tokens.length;
    const rankedText = message.text.replace(URL_PATTERN, " ");
    (rankedText.match(WORD_PATTERN) || []).map((word) => word.toLowerCase().normalize("NFC")).forEach((word) => words.set(word, (words.get(word) || 0) + 1));
    const segments = emojiIn(message.text);
    if (segments) segments.forEach((emoji) => emojis.set(emoji, (emojis.get(emoji) || 0) + 1));
  });
  const totalMessages = messages.length;
  return {
    totalMessages, totalWords, totalMedia,
    activeDays: new Set(messages.map((message) => dateKey(message.date))).size,
    people: [...participants.values()].sort((a, b) => b.messages - a.messages || compareNames(a.name, b.name)),
    hourly, weekdays,
    topWords: rankCounts(new Map([...words].filter(([word]) => (word.match(/\p{L}/gu) || []).length >= 3 && !STOPWORDS.has(word))), 10),
    emojiAvailable: GRAPHEME_SEGMENTER !== null,
    topEmoji: rankCounts(emojis, 10)
  };
}

function calculateAwards(messages, patterns) {
  const awards = [];
  const add = (title, winner, metric, cheeky, measure, supportMessageIds = [], supportPairs = 0) => {
    if (winner) awards.push({ title, name: winner.name, metric: String(metric), cheeky, measure, supportMessageIds, supportPairs });
  };
  const messagesFor = (predicate) => messages.filter(predicate).map((message) => message.exportOrder);
  const hours = (start, end) => {
    const counts = new Map();
    messages.forEach((message) => {
      const hour = message.date.getHours();
      if (hour >= start && hour < end) counts.set(message.author, (counts.get(message.author) || 0) + 1);
    });
    return counts;
  };
  const night = chooseWinner(hours(0, 5));
  add("Night Owl", night, night ? `${night.metric} ${night.metric === 1 ? "message" : "messages"}` : null, "The clock was optional, apparently.", "sent from 00:00 to 04:59",
    night ? messagesFor((message) => message.author === night.name && message.date.getHours() < 5) : []);
  const early = chooseWinner(hours(5, 9));
  add("Early Bird", early, early ? `${early.metric} ${early.metric === 1 ? "message" : "messages"}` : null, "Already on the chat before the day got going.", "sent from 05:00 to 08:59",
    early ? messagesFor((message) => message.author === early.name && message.date.getHours() >= 5 && message.date.getHours() < 9) : []);

  let novelist = null;
  messages.forEach((message) => {
    if (message.isMedia) return;
    const count = wordsIn(message.text).length;
    if (!count) return;
    const candidate = { name: message.author, count, date: message.date, order: message.exportOrder, message };
    const earlier = novelist && (candidate.date < novelist.date ||
      (candidate.date.getTime() === novelist.date.getTime() && candidate.order < novelist.order));
    if (!novelist || count > novelist.count || (count === novelist.count && earlier)) novelist = candidate;
  });
  add("The Novelist", novelist, novelist ? `${novelist.count} words` : null, "A whole paragraph was just getting warmed up.", "words in their longest single non-media message",
    novelist ? [novelist.message.exportOrder] : []);

  const pairsByAuthor = new Map();
  for (let index = 1; index < messages.length; index += 1) {
    const previous = messages[index - 1];
    const current = messages[index];
    if (current.author === previous.author && current.date - previous.date <= 5 * 60 * 1000) {
      if (!pairsByAuthor.has(current.author)) pairsByAuthor.set(current.author, []);
      pairsByAuthor.get(current.author).push([previous, current]);
    }
  }
  const doubleTexter = chooseWinner(new Map([...pairsByAuthor].map(([name, pairs]) => [name, pairs.length])));
  const doublePairs = doubleTexter ? pairsByAuthor.get(doubleTexter.name) : [];
  add("Double-Texter", doubleTexter, doubleTexter ? `${doubleTexter.metric} ${doubleTexter.metric === 1 ? "pair" : "pairs"}` : null,
    "One message was clearly not the whole thought.", "adjacent same-author messages no more than five minutes apart",
    doublePairs.flatMap((pair) => pair.map((message) => message.exportOrder)), doublePairs.length);

  const handoff = patterns.winner;
  if (handoff) {
    awards.push({
      title: "Shortest observed handoff", name: handoff.name,
      metric: `median ${durationLabel(handoff.medianGapSeconds)} (${handoff.handoffCount} samples)`,
      cheeky: "A measured gap between adjacent messages, not a verified reply.",
      measure: "median gap after another author’s immediately preceding matching message, under six hours",
      supportMessageIds: handoff.handoffs.flatMap((pair) => [pair.previous.exportOrder, pair.current.exportOrder]),
      supportPairs: handoff.handoffCount
    });
  }

  const emojiCounts = new Map();
  const emojiSources = new Map();
  const laughCounts = new Map();
  const laughSources = new Map();
  messages.forEach((message) => {
    if (message.isMedia) return;
    const segments = emojiIn(message.text);
    if (segments?.length) {
      emojiCounts.set(message.author, (emojiCounts.get(message.author) || 0) + segments.length);
      if (!emojiSources.has(message.author)) emojiSources.set(message.author, []);
      emojiSources.get(message.author).push(message.exportOrder);
    }
    const laughs = message.text.match(/(?<![\p{L}\p{N}_])(?:haha|lol)(?![\p{L}\p{N}_])/giu) || [];
    if (laughs.length) {
      laughCounts.set(message.author, (laughCounts.get(message.author) || 0) + laughs.length);
      if (!laughSources.has(message.author)) laughSources.set(message.author, []);
      laughSources.get(message.author).push(message.exportOrder);
    }
  });
  const emojiWinner = chooseWinner(emojiCounts);
  if (GRAPHEME_SEGMENTER) add("Emoji Addict", emojiWinner, emojiWinner ? `${emojiWinner.metric} emoji` : null, "That reaction had a reaction.", "graphemes in non-media messages",
    emojiWinner ? emojiSources.get(emojiWinner.name) : []);
  const laughWinner = chooseWinner(laughCounts);
  add("Laugh Track", laughWinner, laughWinner ? `${laughWinner.metric} ${laughWinner.metric === 1 ? "occurrence" : "occurrences"}` : null,
    "The chat supplied its own laugh track.", "standalone haha/lol matches, case-insensitive", laughWinner ? laughSources.get(laughWinner.name) : []);
  return awards;
}
function durationLabel(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remaining = seconds - hours * 3600 - minutes * 60;
  return [hours ? `${hours} ${hours === 1 ? "hour" : "hours"}` : "", minutes ? `${minutes} ${minutes === 1 ? "minute" : "minutes"}` : "",
    remaining || (!hours && !minutes) ? `${Number(remaining.toFixed(1))} ${remaining === 1 ? "second" : "seconds"}` : ""].filter(Boolean).join(" ");
}
function calculateActivity(messages) {
  const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const cells = weekdays.map((day, weekday) => ({ day, weekday, hours: Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0 })) }));
  messages.forEach((message) => {
    const weekday = (message.date.getDay() + 6) % 7;
    cells[weekday].hours[message.date.getHours()].count += 1;
  });
  let busiest = null;
  cells.forEach((row) => row.hours.forEach((cell) => {
    if (cell.count && (!busiest || cell.count > busiest.count)) busiest = { day: row.day, weekday: row.weekday, hour: cell.hour, count: cell.count };
  }));
  const ordinal = (date) => Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
  const localDateFromOrdinal = (value) => {
    const utcDate = new Date(value * 86400000);
    return new Date(utcDate.getUTCFullYear(), utcDate.getUTCMonth(), utcDate.getUTCDate());
  };
  const mondayOrdinal = (date) => ordinal(date) - ((date.getDay() + 6) % 7);
  const countsByWeek = new Map();
  messages.forEach((message) => {
    const week = mondayOrdinal(message.date);
    countsByWeek.set(week, (countsByWeek.get(week) || 0) + 1);
  });
  const weekKeys = [...countsByWeek.keys()].sort((a, b) => a - b);
  const latestMonday = mondayOrdinal(messages[messages.length - 1].date);
  const firstShownMonday = latestMonday - 11 * 7;
  const weeks = Array.from({ length: Math.min(12, Math.floor((latestMonday - weekKeys[0]) / 7) + 1) }, (_, index) => {
    const startOrdinal = Math.max(weekKeys[0], firstShownMonday) + index * 7;
    return { start: localDateFromOrdinal(startOrdinal), end: localDateFromOrdinal(startOrdinal + 6), count: countsByWeek.get(startOrdinal) || 0 };
  });
  return { cells, busiest, weeks, limited: weekKeys[0] < firstShownMonday };
}
function calculatePatterns(messages, people, totalMessages) {
  const handoffs = [];
  for (let index = 1; index < messages.length; index += 1) {
    const previous = messages[index - 1];
    const current = messages[index];
    const elapsed = current.date.getTime() - previous.date.getTime();
    if (previous.author !== current.author && elapsed >= 0 && elapsed < SESSION_GAP_MS) {
      handoffs.push({ laterAuthor: current.author, gapSeconds: elapsed / 1000, previous, current });
    }
  }
  const byAuthor = new Map();
  handoffs.forEach((pair) => {
    if (!byAuthor.has(pair.laterAuthor)) byAuthor.set(pair.laterAuthor, []);
    byAuthor.get(pair.laterAuthor).push(pair);
  });
  const participants = people.map((person) => {
    const pairs = byAuthor.get(person.name) || [];
    const gaps = pairs.map((pair) => pair.gapSeconds).sort((a, b) => a - b);
    const middle = Math.floor(gaps.length / 2);
    const medianGapSeconds = gaps.length < 2 ? null : gaps.length % 2 ? gaps[middle] : (gaps[middle - 1] + gaps[middle]) / 2;
    return { name: person.name, messages: person.messages, share: person.messages / totalMessages * 100, handoffCount: pairs.length, medianGapSeconds, handoffs: pairs };
  });
  const eligible = participants.filter((person) => person.medianGapSeconds !== null)
    .sort((a, b) => a.medianGapSeconds - b.medianGapSeconds || compareNames(a.name, b.name));
  return { participants, handoffs, winner: eligible[0] || null };
}
function calculateStory(messages) {
  const days = new Map();
  const months = new Map();
  const starters = new Map();
  messages.forEach((message) => {
    const day = dateKey(message.date);
    const month = monthKey(message.date);
    days.set(day, (days.get(day) || 0) + 1);
    months.set(month, (months.get(month) || 0) + 1);
  });
  messages.forEach((message, index) => {
    if (index === 0 || message.date - messages[index - 1].date >= SESSION_GAP_MS) {
      starters.set(message.author, (starters.get(message.author) || 0) + 1);
    }
  });
  const dayEntries = [...days].map(([key, count]) => ({ key, count, date: dateFromKey(key) }));
  const monthEntries = [...months].map(([key, count]) => ({ key, count, date: dateFromKey(key) }));
  const busiestDay = [...dayEntries].sort((a, b) => b.count - a.count || compareText(a.key, b.key))[0];
  const busiestMonth = [...monthEntries].sort((a, b) => b.count - a.count || compareText(a.key, b.key))[0];
  let quietest = null;
  let streak = { length: 1, start: dayEntries[0].date, end: dayEntries[0].date };
  let runStart = dayEntries[0].date;
  let runLength = 1;
  for (let i = 1; i < dayEntries.length; i += 1) {
    const gap = localDayNumber(dayEntries[i].date) - localDayNumber(dayEntries[i - 1].date);
    const silentDays = gap - 1;
    if (quietest === null || silentDays > quietest.silentDays) quietest = { start: dayEntries[i - 1].date, end: dayEntries[i].date, silentDays };
    if (gap === 1) runLength += 1;
    else {
      if (runLength > streak.length) streak = { length: runLength, start: runStart, end: dayEntries[i - 1].date };
      runStart = dayEntries[i].date;
      runLength = 1;
    }
  }
  if (runLength > streak.length) streak = { length: runLength, start: runStart, end: dayEntries[dayEntries.length - 1].date };
  const timeline = [];
  let cursor = monthEntries[0].date;
  const lastMonth = monthEntries[monthEntries.length - 1].date;
  while (cursor <= lastMonth) {
    timeline.push({ date: new Date(cursor), count: months.get(monthKey(cursor)) || 0 });
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }
  const starter = [...starters].sort((a, b) => b[1] - a[1] || compareNames(a[0], b[0]))[0];
  return {
    first: messages[0], busiestDay, busiestMonth, quietest, streak,
    starter: { name: starter[0], count: starter[1] }, timeline
  };
}

export function analyzeChat(chat) {
  const messages = authoredMessages(chat);
  if (!messages.length) return null;
  const stats = calculateStats(messages);
  const activity = calculateActivity(messages);
  const patterns = calculatePatterns(messages, stats.people, stats.totalMessages);
  return { messages, stats, activity, patterns, awards: calculateAwards(messages, patterns), story: calculateStory(messages) };
}

export const ANALYSIS_STOPWORDS = STOPWORDS;
