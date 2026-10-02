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
  return chat.messages.map((message, exportOrder) => ({ ...message, exportOrder }))
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

function calculateAwards(messages) {
  const awards = [];
  const add = (title, winner, metric, cheeky, measure) => {
    if (winner) awards.push({ title, name: winner.name, metric: String(metric), cheeky, measure });
  };
  const hours = (start, end) => {
    const counts = new Map();
    messages.forEach((message) => {
      const hour = message.date.getHours();
      if (hour >= start && hour < end) counts.set(message.author, (counts.get(message.author) || 0) + 1);
    });
    return counts;
  };
  const night = chooseWinner(hours(0, 5));
  add("Night Owl", night, night ? `${night.metric} ${night.metric === 1 ? "message" : "messages"}` : null, "The clock was optional, apparently.", "sent from 00:00 to 04:59");
  const early = chooseWinner(hours(5, 9));
  add("Early Bird", early, early ? `${early.metric} ${early.metric === 1 ? "message" : "messages"}` : null, "Already on the chat before the day got going.", "sent from 05:00 to 08:59");

  let novelist = null;
  messages.forEach((message) => {
    if (message.isMedia) return;
    const count = wordsIn(message.text).length;
    if (!count) return;
    const candidate = { name: message.author, count, date: message.date, order: message.exportOrder };
    const earlier = novelist && (candidate.date < novelist.date ||
      (candidate.date.getTime() === novelist.date.getTime() &&
        (candidate.order < novelist.order || (candidate.order === novelist.order && compareNames(candidate.name, novelist.name) < 0))));
    if (!novelist || count > novelist.count || (count === novelist.count && earlier)) novelist = candidate;
  });
  add("The Novelist", novelist, novelist ? `${novelist.count} words` : null, "A whole paragraph was just getting warmed up.", "words in their longest single non-media message");

  const pairs = new Map();
  for (let i = 1; i < messages.length; i += 1) {
    const previous = messages[i - 1];
    const current = messages[i];
    if (current.author === previous.author && current.date - previous.date <= 5 * 60 * 1000) {
      pairs.set(current.author, (pairs.get(current.author) || 0) + 1);
    }
  }
  const doubleTexter = chooseWinner(pairs);
  add("Double-Texter", doubleTexter, doubleTexter ? `${doubleTexter.metric} ${doubleTexter.metric === 1 ? "pair" : "pairs"}` : null,
    "One message was clearly not the whole thought.", "adjacent same-author messages no more than five minutes apart");

  const replies = new Map();
  for (let i = 0; i < messages.length; i += 1) {
    for (let j = i + 1; j < messages.length; j += 1) {
      if (messages[j].date - messages[j - 1].date >= SESSION_GAP_MS) break;
      if (messages[j].author !== messages[i].author) {
        if (!replies.has(messages[j].author)) replies.set(messages[j].author, []);
        replies.get(messages[j].author).push((messages[j].date - messages[i].date) / 1000);
        break;
      }
    }
  }
  const eligible = [...replies].filter(([, times]) => times.length >= 2).map(([name, times]) => {
    times.sort((a, b) => a - b);
    const middle = Math.floor(times.length / 2);
    return { name, times, median: times.length % 2 ? times[middle] : (times[middle - 1] + times[middle]) / 2 };
  }).sort((a, b) => a.median - b.median || compareNames(a.name, b.name));
  if (eligible.length) {
    const winner = eligible[0];
    const seconds = winner.median;
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;
    const duration = [
      hours ? `${hours} ${hours === 1 ? "hour" : "hours"}` : "",
      minutes ? `${minutes} ${minutes === 1 ? "minute" : "minutes"}` : "",
      remainingSeconds || (!hours && !minutes) ? `${remainingSeconds} ${remainingSeconds === 1 ? "second" : "seconds"}` : ""
    ].filter(Boolean).join(" ");
    awards.push({ title: "Fastest Replier", name: winner.name, metric: `median ${duration} (${winner.times.length} replies)`,
      cheeky: "Replies arrived before the conversation could gather dust.", measure: "median elapsed time across qualifying direct replies" });
  }

  const emojiCounts = new Map();
  const laughCounts = new Map();
  messages.forEach((message) => {
    if (message.isMedia) return;
    const segments = emojiIn(message.text);
    if (segments?.length) emojiCounts.set(message.author, (emojiCounts.get(message.author) || 0) + segments.length);
    const laughs = message.text.match(/(?<![\p{L}\p{N}_])(?:haha|lol)(?![\p{L}\p{N}_])/giu) || [];
    if (laughs.length) laughCounts.set(message.author, (laughCounts.get(message.author) || 0) + laughs.length);
  });
  const emojiWinner = chooseWinner(emojiCounts);
  if (GRAPHEME_SEGMENTER) add("Emoji Addict", emojiWinner, emojiWinner ? `${emojiWinner.metric} emoji` : null, "That reaction had a reaction.", "graphemes in non-media messages");
  const laughWinner = chooseWinner(laughCounts);
  add("Laugh Track", laughWinner, laughWinner ? `${laughWinner.metric} ${laughWinner.metric === 1 ? "occurrence" : "occurrences"}` : null, "The chat supplied its own laugh track.", "standalone haha/lol matches, case-insensitive");
  return awards;
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
  return { messages, stats: calculateStats(messages), awards: calculateAwards(messages), story: calculateStory(messages) };
}

export const ANALYSIS_STOPWORDS = STOPWORDS;