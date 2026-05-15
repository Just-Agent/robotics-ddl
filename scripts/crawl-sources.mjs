import fs from 'node:fs';

async function robocupAdapter() {
  return {
    source: "RoboCup",
    url: "https://www.robocup.org",
    items: [],
    note: 'TODO: implement parser for RoboCup; keep data/items.json as curated fallback until parser is verified.'
  };
}

async function icraAdapter() {
  return {
    source: "ICRA",
    url: "https://www.ieee-ras.org/conferences-workshops/fully-sponsored/icra",
    items: [],
    note: 'TODO: implement parser for ICRA; keep data/items.json as curated fallback until parser is verified.'
  };
}

async function irosAdapter() {
  return {
    source: "IROS",
    url: "https://www.ieee-ras.org/conferences-workshops/financially-co-sponsored/iros",
    items: [],
    note: 'TODO: implement parser for IROS; keep data/items.json as curated fallback until parser is verified.'
  };
}

async function aicrowdRoboticsAdapter() {
  return {
    source: "AIcrowd Robotics Challenges",
    url: "https://www.aicrowd.com/challenges",
    items: [],
    note: 'TODO: implement parser for AIcrowd Robotics Challenges; keep data/items.json as curated fallback until parser is verified.'
  };
}

const adapters = [robocupAdapter, icraAdapter, irosAdapter, aicrowdRoboticsAdapter];
const existingItemsUrl = new URL('../data/items.json', import.meta.url);
const existingItems = JSON.parse(fs.readFileSync(existingItemsUrl, 'utf8'));
const reports = [];

for (const adapter of adapters) {
  reports.push(await adapter());
}

const harvestedItems = reports.flatMap(report => report.items);
if (harvestedItems.length > 0) {
  fs.writeFileSync(existingItemsUrl, JSON.stringify(harvestedItems, null, 2) + '\n', 'utf8');
  console.log(`crawler wrote ${harvestedItems.length} fetched items`);
} else {
  console.log(`crawler adapters ran; no verified fetched items yet, preserving ${existingItems.length} curated items`);
}

fs.writeFileSync(new URL('../data/crawl-report.json', import.meta.url), JSON.stringify({
  generatedAt: new Date().toISOString(),
  topicId: "robotics-ddl",
  adapters: reports
}, null, 2) + '\n', 'utf8');
