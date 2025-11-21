import * as fs from "fs";
import * as path from "path";
import { EventEmitter } from "events";
import { parse } from "yaml";

type TipChannelOverlay = {
  type: "overlay";
  severity?: "info" | "warning" | "critical";
  icon?: string;
  title: string;
  body?: string;
  stickyMs?: number;
  sound?: string;
};

type TipNotify = {
  channels: Array<TipChannelOverlay>;
  throttleSec?: number;
};

type PhaseCondition = {
  maxGameTimeSec?: number;
  minGameTimeSec?: number;
};

type RuleWhen = {
  phase?: PhaseCondition;
  modes?: string[];
};

type TriggerCannonWave = {
  type: "cannon_wave";
  leadSeconds: number | number[];
};

type TriggerObjectiveSpawn = {
  type: "objective_spawn";
  objective: "dragon" | "herald" | "baron";
  leadSeconds: number | number[];
};

type Rule = {
  id: string;
  name: string;
  description?: string;
  when?: RuleWhen;
  trigger: TriggerCannonWave | TriggerObjectiveSpawn; // union for future triggers
  notify: TipNotify;
  enabled?: boolean;
};

type Module = {
  id: string;
  rules: Rule[];
  enabled?: boolean;
};

type TipsConfigV1 = {
  version: 1;
  modules: Module[];
};

export type TipPayload = {
  id: string;
  title: string;
  body?: string;
  icon?: string;
  severity?: "info" | "warning" | "critical";
  stickyMs?: number;
  metadata?: Record<string, unknown>;
};

type SnapshotLike = {
  game?: { time?: number; mode?: string };
  objectives?: {
    dragon?: { nextSpawnTime?: number };
    herald?: { nextSpawnTime?: number };
    baron?: { nextSpawnTime?: number };
  };
};
type GetSnapshotFn = () => Promise<SnapshotLike>;

function loadYamlFiles(dir: string): TipsConfigV1 {
  let modules: Module[] = [];
  try {
    const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
    for (const f of files) {
      if (!f.endsWith(".yml") && !f.endsWith(".yaml")) continue;
      const raw = fs.readFileSync(path.join(dir, f), "utf8");
      const obj = parse(raw) as Partial<TipsConfigV1>;
      if (obj?.modules?.length) {
        modules = modules.concat(obj.modules as Module[]);
      }
    }
  } catch {
    // ignore read errors; fallback to empty config
  }
  return { version: 1, modules };
}

function inPhase(when: RuleWhen | undefined, gameTime: number): boolean {
  if (!when?.phase) return true;
  const { minGameTimeSec, maxGameTimeSec } = when.phase;
  if (typeof minGameTimeSec === "number" && gameTime < minGameTimeSec)
    return false;
  if (typeof maxGameTimeSec === "number" && gameTime > maxGameTimeSec)
    return false;
  return true;
}

function modeAllowed(
  when: RuleWhen | undefined,
  mode: string | undefined
): boolean {
  if (!when?.modes || when.modes.length === 0) return true;
  if (!mode) return false;
  return when.modes.includes(mode);
}

function getLeadList(lead: number | number[]): number[] {
  return Array.isArray(lead) ? lead.slice().sort((a, b) => a - b) : [lead];
}

// Summoner's Rift wave timing (simplified): first wave at 90s, then every 30s
// Cannon waves every 3rd wave until 20:00. We only handle laning phase (<20:00) for now.
function getNextCannonWavesBefore20(
  nowSec: number
): { waveIndex: number; spawnTime: number }[] {
  const waves: { waveIndex: number; spawnTime: number }[] = [];
  const FIRST_WAVE = 90;
  const CADENCE = 30;
  const END = 1200; // 20 min
  // compute current wave index (1-based) floor
  const currentWaveIndex =
    nowSec < FIRST_WAVE ? 0 : Math.floor((nowSec - FIRST_WAVE) / CADENCE) + 1;
  // next few cannon waves
  for (let i = currentWaveIndex + 1; ; i++) {
    const t = FIRST_WAVE + (i - 1) * CADENCE;
    if (t > END) break;
    if (i % 3 === 0) {
      waves.push({ waveIndex: i, spawnTime: t });
      // limit number returned
      if (waves.length >= 5) break;
    }
  }
  return waves;
}

type FiredKey = string; // `${ruleId}:${lead}:${waveIndex}`

export class TipsEngine extends EventEmitter {
  private readonly getSnapshot: GetSnapshotFn;
  private readonly configDir: string;
  private timer: NodeJS.Timeout | null = null;
  private lastNow = 0;
  private fired = new Set<FiredKey>();
  private lastFiredAtMs = new Map<FiredKey, number>();
  private config: TipsConfigV1 = { version: 1, modules: [] };

  constructor(options: { getSnapshot: GetSnapshotFn; configDir?: string }) {
    super();
    this.getSnapshot = options.getSnapshot;
    this.configDir =
      options.configDir || path.resolve(process.cwd(), "data", "tips");
    this.reload();
    this.setupWatch();
  }

  start() {
    this.stop();
    this.timer = setInterval(() => void this.tick(), 1000);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private reload() {
    this.config = loadYamlFiles(this.configDir);
  }

  private setupWatch() {
    try {
      if (fs.existsSync(this.configDir)) {
        fs.watch(this.configDir, { persistent: false }, () => {
          try {
            this.reload();
          } catch {
            // ignore parse errors
          }
        });
      }
    } catch {
      // ignore
    }
  }

  private async tick() {
    try {
      const snap = await this.getSnapshot();
      const nowSec = snap.game?.time ?? 0;
      const mode = snap.game?.mode ?? "";

      if (nowSec < this.lastNow) {
        this.fired.clear();
      }
      this.lastNow = nowSec;

      for (const mod of this.config.modules || []) {
        if (mod?.enabled === false) continue;
        for (const rule of mod.rules || []) {
          if (rule?.enabled === false) continue;
          if (!inPhase(rule.when, nowSec)) continue;
          if (!modeAllowed(rule.when, mode)) continue;

          if (rule.trigger.type === "cannon_wave") {
            if (nowSec >= 1200) continue;
            const leads = getLeadList(rule.trigger.leadSeconds);
            const upcoming = getNextCannonWavesBefore20(nowSec);
            for (const wave of upcoming) {
              const timeToSpawn = wave.spawnTime - nowSec;
              for (const lead of leads) {
                const key: FiredKey = `${rule.id}:${lead}:${wave.waveIndex}`;
                const withinWindow =
                  timeToSpawn <= lead && timeToSpawn > lead - 2.1;
                if (withinWindow && !this.fired.has(key)) {
                  // throttle per key if configured
                  const throttleMs = Math.max(
                    0,
                    Math.floor((rule.notify?.throttleSec || 0) * 1000)
                  );
                  if (throttleMs > 0) {
                    const prev = this.lastFiredAtMs.get(key) || 0;
                    if (Date.now() - prev < throttleMs) {
                      continue;
                    }
                    this.lastFiredAtMs.set(key, Date.now());
                  }
                  this.fired.add(key);
                  const chan = (rule.notify?.channels || []).find(
                    (c) => c.type === "overlay"
                  ) as TipChannelOverlay | undefined;
                  const titleTpl = chan?.title || "Cannon wave in {lead}s";
                  const bodyTpl =
                    chan?.body || "Prepare to secure the cannon minion.";
                  const payload: TipPayload = {
                    id: rule.id,
                    title: titleTpl.replace("{lead}", String(lead)),
                    body: bodyTpl.replace("{lead}", String(lead)),
                    icon: chan?.icon || "🛡️",
                    severity: chan?.severity || "info",
                    stickyMs: chan?.stickyMs ?? 4000,
                    metadata: {
                      lead,
                      waveIndex: wave.waveIndex,
                      spawnTime: wave.spawnTime,
                    },
                  };
                  this.emit("tip", payload);
                }
              }
            }
          } else if (rule.trigger.type === "objective_spawn") {
            const leads = getLeadList(rule.trigger.leadSeconds);
            const next =
              (rule.trigger.objective === "dragon"
                ? this.safeNext(this.safeObj(snap, "dragon"))
                : rule.trigger.objective === "herald"
                ? this.safeNext(this.safeObj(snap, "herald"))
                : this.safeNext(this.safeObj(snap, "baron"))) ?? null;
            if (!next || next <= 0) continue;
            const timeToSpawn = next - nowSec;
            if (timeToSpawn <= 0) continue;
            for (const lead of leads) {
              const key: FiredKey = `${rule.id}:${
                rule.trigger.objective
              }:${lead}:${Math.round(next)}`;
              const withinWindow =
                timeToSpawn <= lead && timeToSpawn > lead - 2.1;
              if (withinWindow && !this.fired.has(key)) {
                const throttleMs = Math.max(
                  0,
                  Math.floor((rule.notify?.throttleSec || 0) * 1000)
                );
                if (throttleMs > 0) {
                  const prev = this.lastFiredAtMs.get(key) || 0;
                  if (Date.now() - prev < throttleMs) {
                    continue;
                  }
                  this.lastFiredAtMs.set(key, Date.now());
                }
                this.fired.add(key);
                const chan = (rule.notify?.channels || []).find(
                  (c) => c.type === "overlay"
                ) as TipChannelOverlay | undefined;
                const titleTpl =
                  chan?.title || `Prepare ${rule.trigger.objective} in {lead}s`;
                const bodyTpl =
                  chan?.body ||
                  `Group and secure vision for ${rule.trigger.objective}.`;
                const payload: TipPayload = {
                  id: rule.id,
                  title: titleTpl.replace("{lead}", String(lead)),
                  body: bodyTpl.replace("{lead}", String(lead)),
                  icon: chan?.icon || "⚑",
                  severity: chan?.severity || "warning",
                  stickyMs: chan?.stickyMs ?? 5000,
                  metadata: {
                    lead,
                    objective: rule.trigger.objective,
                    nextSpawnTime: next,
                  },
                };
                this.emit("tip", payload);
              }
            }
          }
        }
      }
    } catch {
      // ignore tick errors
    }
  }

  private safeObj(
    snap: SnapshotLike,
    key: "dragon" | "herald" | "baron"
  ): { nextSpawnTime?: number } | undefined {
    return (snap.objectives as any)?.[key];
  }
  private safeNext(obj?: { nextSpawnTime?: number }): number | undefined {
    if (!obj) return undefined;
    return typeof obj.nextSpawnTime === "number"
      ? obj.nextSpawnTime
      : undefined;
  }
}
