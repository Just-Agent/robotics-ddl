import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const CRAWL_TIMEOUT_MS = Number(process.env.CRAWL_TIMEOUT_MS) || 20000;
const REACHABILITY_TIMEOUT_MS = Number(process.env.REACHABILITY_TIMEOUT_MS) || Math.min(7000, CRAWL_TIMEOUT_MS);
const USER_AGENT = 'Just-DDL-Crawler/1.0 (+https://just-agent.github.io/just-ddl/)';

function extractTitle(html) {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return match ? match[1].trim().slice(0, 200) : null;
}

function fetchViaPowerShell(url) {
  if (process.platform !== 'win32') return null;
  const timeoutSec = Math.max(15, Math.ceil(CRAWL_TIMEOUT_MS / 1000) + 5);
  const escapedUrl = url.replace(/'/g, "''");
  const script = "$ProgressPreference='SilentlyContinue'; [Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); (Invoke-WebRequest -Uri '" + escapedUrl + "' -UseBasicParsing -TimeoutSec " + timeoutSec + " -Headers @{ 'User-Agent'='Mozilla/5.0'; 'Accept-Language'='en-US,en;q=0.9' }).Content";
  for (const command of ['pwsh', 'powershell']) {
    const result = spawnSync(command, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
      timeout: (timeoutSec + 5) * 1000
    });
    if (result.status === 0 && result.stdout && result.stdout.trim().length > 1000) {
      return result.stdout;
    }
  }
  return null;
}

async function fetchSourcePage(source) {
  const report = {
    sourceId: source.id,
    source: source.name,
    url: source.url,
    items: [],
    reachable: false,
    httpStatus: null,
    finalUrl: null,
    title: null,
    contentLength: null,
    fetchedAt: new Date().toISOString(),
    note: 'Source reachability check only; curated data/items.json preserved until item parser is implemented.',
    error: null
  };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REACHABILITY_TIMEOUT_MS);
    const res = await fetch(source.url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT }
    });
    clearTimeout(timer);
    report.httpStatus = res.status;
    report.finalUrl = res.url;
    const text = await res.text();
    report.contentLength = text.length;
    report.title = extractTitle(text);
    report.reachable = res.status >= 200 && res.status < 400;
    report.note = report.reachable
      ? 'Source reachable. Curated data/items.json preserved until item parser is implemented.'
      : `Source returned HTTP ${res.status}. Curated data/items.json preserved.`;
  } catch (err) {
    report.error = err.name === 'AbortError' ? `Timeout after ${REACHABILITY_TIMEOUT_MS}ms` : err.message;
    report.note = `Source fetch failed: ${report.error}. Curated data/items.json preserved.`;
  }
  return report;
}

const AICITY_URL = 'https://www.aicitychallenge.org';
const AICITY_MIN_ITEMS = 3;
const AICITY_MAX_FUTURE_DAYS = Number(process.env.AICITY_MAX_FUTURE_DAYS) || 500;

function aiCityDecode(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function aiCityText(html) {
  return aiCityDecode(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseAiCityDate(value) {
  const months = { january:0,february:1,march:2,april:3,may:4,june:5,july:6,august:7,september:8,october:9,november:10,december:11,jan:0,feb:1,mar:2,apr:3,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  const rangeMatch = text.match(/([A-Za-z]+)\s+(\d{1,2})\s*\/\s*(\d{1,2}),\s*(\d{4})/i);
  if (rangeMatch) {
    const month = months[rangeMatch[1].toLowerCase()];
    return month === undefined ? null : new Date(Date.UTC(Number(rangeMatch[4]), month, Number(rangeMatch[3]), 23, 59, 59));
  }
  const fullMatch = text.match(/([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/i);
  if (!fullMatch) return null;
  const month = months[fullMatch[1].toLowerCase()];
  return month === undefined ? null : new Date(Date.UTC(Number(fullMatch[3]), month, Number(fullMatch[2]), 23, 59, 59));
}

function aiCitySlug(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function parseAiCityChallengeItems() {
  const report = {
    sourceId: 'aicity',
    source: 'AI City Challenge',
    url: AICITY_URL,
    items: [],
    reachable: false,
    httpStatus: null,
    finalUrl: null,
    title: null,
    contentLength: null,
    fetchedAt: new Date().toISOString(),
    note: 'AI City Challenge important dates parser.',
    error: null,
    parsedItemCount: 0,
    invalidItemCount: 0,
    parserHealthy: false
  };
  try {
    let text;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), CRAWL_TIMEOUT_MS);
      const res = await fetch(AICITY_URL, {
        redirect: 'follow',
        signal: controller.signal,
        headers: { 'User-Agent': USER_AGENT, 'Accept': 'text/html', 'Accept-Language': 'en-US,en;q=0.9' }
      });
      clearTimeout(timer);
      report.httpStatus = res.status;
      report.finalUrl = res.url;
      text = await res.text();
      report.reachable = res.status >= 200 && res.status < 400;
    } catch (fetchErr) {
      const fallbackText = fetchViaPowerShell(AICITY_URL);
      if (!fallbackText) throw fetchErr;
      text = fallbackText;
      report.httpStatus = 200;
      report.finalUrl = AICITY_URL;
      report.reachable = true;
      report.note = 'Fetched AI City Challenge with Windows PowerShell fallback after Node fetch failed.';
    }
    report.contentLength = text.length;
    report.title = (text.match(/<title[^>]*>([^<]+)<\/title>/i) || [])[1] || null;
    if (!report.reachable) {
      report.note = 'AI City Challenge returned HTTP ' + report.httpStatus + '. No items parsed.';
      return report;
    }

    const clean = aiCityText(text);
    const datesStart = clean.search(/Important Dates/i);
    const datesSection = datesStart >= 0 ? clean.slice(datesStart, datesStart + 4000) : clean;
    const explicitRe = /([^:.]{8,180}?):\s*((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:\s*\/\s*\d{1,2})?,\s*\d{4})/gi;
    const seen = new Set();
    let match;
    while ((match = explicitRe.exec(datesSection)) !== null) {
      let label = match[1].replace(/^[\s.;:-]+|[\s.;:-]+$/g, '').trim();
      const dateLabel = match[2].trim();
      if (!label || label.length > 160 || /Important Dates/i.test(label)) {
        label = label.replace(/.*Important Dates\s*/i, '').trim();
      }
      const deadlineDate = parseAiCityDate(dateLabel);
      if (!deadlineDate || isNaN(deadlineDate.getTime())) {
        report.invalidItemCount += 1;
        continue;
      }
      const daysFromNow = (deadlineDate.getTime() - Date.now()) / 86400000;
      if (daysFromNow < -7 || daysFromNow > AICITY_MAX_FUTURE_DAYS) {
        report.invalidItemCount += 1;
        continue;
      }
      const id = 'aicity-2026-' + aiCitySlug(label + '-' + dateLabel);
      if (seen.has(id)) continue;
      seen.add(id);
      report.items.push({
        id,
        title: 'AI City Challenge 2026 - ' + label,
        deadline: deadlineDate.toISOString().replace('.000Z', 'Z'),
        dateRange: dateLabel,
        location: 'Online / CVPR workshop',
        isOnline: true,
        tags: ['robotics', 'autonomous', 'smart city', 'AI City'],
        url: AICITY_URL,
        sourceUrl: AICITY_URL,
        canonicalUrl: AICITY_URL,
        verificationLevel: 'official_event_page',
        status: 'upcoming',
        description: 'Parsed from official AI City Challenge Important Dates section.',
        stage: /submission|deadline|due|code/i.test(label) ? 'Deadline' : 'Milestone',
        source: 'AI City Challenge',
        type: 'challenge'
      });
    }

    const registration = clean.match(/Registration opens on\s+((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s*\d{4})/i);
    if (registration) {
      const dateLabel = registration[1];
      const deadlineDate = parseAiCityDate(dateLabel);
      const id = 'aicity-2026-registration-opens';
      if (deadlineDate && !isNaN(deadlineDate.getTime()) && !seen.has(id)) {
        const daysFromNow = (deadlineDate.getTime() - Date.now()) / 86400000;
        if (daysFromNow >= -7 && daysFromNow <= AICITY_MAX_FUTURE_DAYS) {
          report.items.push({
            id,
            title: 'AI City Challenge 2026 - Registration opens',
            deadline: deadlineDate.toISOString().replace('.000Z', 'Z'),
            dateRange: dateLabel,
            location: 'Online',
            isOnline: true,
            tags: ['robotics', 'autonomous', 'smart city', 'AI City'],
            url: AICITY_URL,
            sourceUrl: AICITY_URL,
            canonicalUrl: AICITY_URL,
            verificationLevel: 'official_event_page',
            status: 'upcoming',
            description: 'Parsed from official AI City Challenge page.',
            stage: 'Registration',
            source: 'AI City Challenge',
            type: 'challenge'
          });
        }
      }
    }

    report.items.sort((a, b) => new Date(a.deadline) - new Date(b.deadline));
    report.parsedItemCount = report.items.length;
    report.parserHealthy = report.parsedItemCount >= AICITY_MIN_ITEMS;
    report.note = 'Parsed ' + report.parsedItemCount + ' items from AI City Challenge; rejected ' + report.invalidItemCount + ' entries.';
  } catch (err) {
    report.error = err.name === 'AbortError' ? 'Timeout after ' + CRAWL_TIMEOUT_MS + 'ms' : err.message;
    report.note = 'AI City Challenge fetch failed: ' + report.error;
  }
  return report;
}

async function aiCityChallengeAdapter() {
  return parseAiCityChallengeItems();
}
async function robocupAdapter() {
  return fetchSourcePage({ id: "robocup", name: "RoboCup", url: "https://www.robocup.org" });
}

async function icraAdapter() {
  return fetchSourcePage({ id: "icra", name: "ICRA", url: "https://www.ieee-ras.org/conferences-workshops/fully-sponsored/icra" });
}

async function irosAdapter() {
  return fetchSourcePage({ id: "iros", name: "IROS", url: "https://www.ieee-ras.org/conferences-workshops/financially-co-sponsored/iros" });
}

async function aicrowdRoboticsAdapter() {
  return fetchSourcePage({ id: "aicrowd", name: "AIcrowd Robotics Challenges", url: "https://www.aicrowd.com/challenges" });
}

const adapters = [robocupAdapter, icraAdapter, irosAdapter, aiCityChallengeAdapter, aicrowdRoboticsAdapter];
const existingItemsUrl = new URL('../data/items.json', import.meta.url);
const existingItems = JSON.parse(fs.readFileSync(existingItemsUrl, 'utf8'));
let previousParsedItemCount = null;
try {
  const previousReport = JSON.parse(fs.readFileSync(new URL('../data/crawl-report.json', import.meta.url), 'utf8'));
  previousParsedItemCount = previousReport.parsedItemCount ?? null;
} catch {}
const reports = await Promise.all(adapters.map(adapter => adapter()));

const harvestedItems = reports.flatMap(report => report.items);
const parsedItemCount = reports.reduce((s, r) => s + (r.parsedItemCount || 0), 0);
const parserHealthy = reports.every(r => r.parserHealthy !== false);
const parserDropOk = previousParsedItemCount === null || parsedItemCount >= Math.floor(previousParsedItemCount * 0.5);

function mergeFetchedWithExisting(fetchedItems, currentItems) {
  const merged = new Map();
  for (const item of currentItems) {
    if (item?.id) merged.set(item.id, item);
  }
  for (const item of fetchedItems) {
    if (item?.id) merged.set(item.id, item);
  }
  return [...merged.values()].sort((a, b) => {
    const dateDiff = Date.parse(a.deadline) - Date.parse(b.deadline);
    if (dateDiff !== 0) return dateDiff;
    return String(a.title || '').localeCompare(String(b.title || ''), 'zh-CN');
  });
}

if (harvestedItems.length >= AICITY_MIN_ITEMS && parserHealthy && parserDropOk) {
  const mergedItems = mergeFetchedWithExisting(harvestedItems, existingItems);
  fs.writeFileSync(existingItemsUrl, JSON.stringify(mergedItems, null, 2) + '\n', 'utf8');
  console.log('crawler wrote ' + harvestedItems.length + ' fetched items; preserved/merged total ' + mergedItems.length + ' items');
} else {
  console.log('parser emitted ' + harvestedItems.length + ' items (health gate failed or threshold not met); preserving ' + existingItems.length + ' curated items in data/items.json');
}

const reachableCount = reports.filter(r => r.reachable).length;
console.log('reachability: ' + reachableCount + '/' + reports.length + ' sources reachable');
if (parsedItemCount > 0) console.log('parsedItemCount: ' + parsedItemCount);

fs.writeFileSync(new URL('../data/crawl-report.json', import.meta.url), JSON.stringify({
  topicId: "robotics-ddl",
  generatedAt: new Date().toISOString(),
  adapterCount: reports.length,
  reachableCount,
  parsedItemCount,
  previousParsedItemCount,
  parserHealthy,
  parserDropOk,
  adapters: reports
}, null, 2) + '\n', 'utf8');
