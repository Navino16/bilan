// @types/node tracks the Node runtime major (engines.node), like the Dependabot ignore rule.
// TypeScript 7 (native compiler) isn't supported by typescript-eslint yet: stay on 6.x.
const MINOR_ONLY = new Set(["@types/node", "typescript"]);

module.exports = {
  target: (name) => (MINOR_ONLY.has(name) ? "minor" : "latest"),
};
