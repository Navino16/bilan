export type DeviceInfo = { browser: string | null; os: string | null; mobile: boolean };

// First match wins: Edge and Opera also carry "Chrome/", Chrome carries "Safari/".
const BROWSERS: [RegExp, string][] = [
  [/Edg(A|iOS)?\//, "Edge"],
  [/OPR\//, "Opera"],
  [/(Firefox|FxiOS)\//, "Firefox"],
  [/(Chrome|CriOS|Chromium)\//, "Chrome"],
  [/Version\/.*Safari\//, "Safari"],
];

const SYSTEMS: [RegExp, string][] = [
  [/iPhone/, "iPhone"],
  [/iPad/, "iPad"],
  [/Android/, "Android"],
  [/Windows/, "Windows"],
  [/CrOS/, "ChromeOS"],
  [/Mac OS X/, "macOS"],
  [/Linux/, "Linux"],
];

function firstMatch(ua: string, table: [RegExp, string][]): string | null {
  return table.find(([re]) => re.test(ua))?.[1] ?? null;
}

export function describeUserAgent(ua: string | null): DeviceInfo {
  if (!ua) return { browser: null, os: null, mobile: false };
  return {
    browser: firstMatch(ua, BROWSERS),
    os: firstMatch(ua, SYSTEMS),
    mobile: /Mobi|iPhone|iPad|Android/.test(ua),
  };
}
