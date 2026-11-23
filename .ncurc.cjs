// @types/node tracks the Node runtime major (engines.node), like the Renovate rule.
// TypeScript 7 (native compiler) isn't supported by typescript-eslint yet: stay on 6.x.
const MINOR_ONLY = new Set(["@types/node", "typescript"]);

module.exports = {
  target: (name) => (MINOR_ONLY.has(name) ? "minor" : "latest"),
  // Same 24 h hold as Renovate's minimumReleaseAge.
  cooldown: "24h",
};
