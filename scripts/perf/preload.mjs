// Preloaded into the benchmarked server: SIGUSR2 appends the event-loop delay and memory peaks
// since the previous signal to $PERF_STATS_FILE, then resets them.
import { monitorEventLoopDelay } from "node:perf_hooks";
import fs from "node:fs";

const eld = monitorEventLoopDelay({ resolution: 10 });
eld.enable();
let peakRss = 0;
setInterval(() => {
  peakRss = Math.max(peakRss, process.memoryUsage().rss);
}, 50).unref();

process.on("SIGUSR2", () => {
  const rss = process.memoryUsage().rss;
  const stats = { eldMax: eld.max / 1e6, peakRssMb: Math.round(Math.max(peakRss, rss) / 1048576) };
  fs.appendFileSync(process.env.PERF_STATS_FILE, JSON.stringify(stats) + "\n");
  eld.reset();
  peakRss = rss;
});
