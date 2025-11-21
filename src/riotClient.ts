import * as https from "https";
import * as fs from "fs";
import * as path from "path";

const LCU_HOST = "127.0.0.1";
const LCU_PORT = 2999;

const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
});

async function getJson<T>(pathname: string): Promise<T> {
  const options: https.RequestOptions = {
    hostname: LCU_HOST,
    port: LCU_PORT,
    path: pathname,
    method: "GET",
    agent: httpsAgent,
    headers: { Accept: "application/json" },
  };
  return await new Promise<T>((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        try {
          resolve(JSON.parse(data) as T);
        } catch (err) {
          reject(
            new Error(
              `Failed to parse JSON from ${pathname}: ${(err as Error).message}`
            )
          );
        }
      });
    });
    req.on("error", (err) => reject(err));
    req.end();
  });
}

export interface AggregatedSnapshot {
  error: boolean;
  message?: string;
  game: { mode: string; modeName: string; time: number };
  player: {
    name: string;
    riotId: string | null;
    champion: string;
    team: string;
    level: number;
  };
  runes: { keystone: string; primaryTree: string; secondaryTree: string };
  stats: {
    kills: number;
    deaths: number;
    assists: number;
    cs: number;
    vision: number;
  };
  items: (string | null)[]; // Array of 7 items indexed by slot (0-6), where 6 is trinket
  spells: { d: string; f: string };
  abilities: {
    q: { name: string } | null;
    w: { name: string } | null;
    e: { name: string } | null;
    r: { name: string } | null;
  };
  derived: {
    kda: string;
    csPerMin: number;
    visionPerMin: number;
  };
  team: {
    myTeam: string;
    enemyTeam: string | null;
    kills: number;
    enemyKills: number;
    turrets: { myTeam: number; enemyTeam: number };
    inhibs: { myTeam: number; enemyTeam: number };
  };
  objectives: {
    dragon: {
      nextSpawnTime: number;
      timeToSpawn: string;
      lastKillType: string | null;
    };
    herald: {
      nextSpawnTime: number;
      timeToSpawn: string;
      despawnsAt: number;
      despawnsIn: string;
    };
    baron: { nextSpawnTime: number; timeToSpawn: string };
  };
  assets?: {
    version: string;
    championIconUrl: string | null;
    itemIconUrls: (string | null)[]; // Array of 7 item icon URLs indexed by slot (0-6)
    runeIcons: {
      keystone: string | null;
      primaryTree: string | null;
      secondaryTree: string | null;
    };
  };
  raw: { gameStats: any; events: Array<any> };
}

type RiotGameModeEntry = { gameMode: string; description: string };
let cachedGameModeMap: Map<string, string> | null = null;
function getGameModeMap(): Map<string, string> {
  if (cachedGameModeMap) return cachedGameModeMap;
  try {
    const filePath = path.resolve(
      process.cwd(),
      "data",
      "riot",
      "gameModes.json"
    );
    const raw = fs.readFileSync(filePath, "utf8");
    const arr = JSON.parse(raw) as RiotGameModeEntry[];
    const map = new Map<string, string>();
    for (const e of arr) {
      if (e?.gameMode)
        map.set(
          String(e.gameMode).trim(),
          e?.description || String(e.gameMode).trim()
        );
    }
    cachedGameModeMap = map;
  } catch {
    cachedGameModeMap = new Map<string, string>();
  }
  return cachedGameModeMap;
}
function resolveGameModeName(mode: string | undefined): string {
  if (!mode) return "";
  const map = getGameModeMap();
  return map.get(mode) || mode;
}

function secondsToClock(s: number): string {
  const sign = s < 0 ? "-" : "";
  const abs = Math.abs(Math.floor(s));
  const m = Math.floor(abs / 60).toString();
  const sec = (abs % 60).toString().padStart(2, "0");
  return `${sign}${m}:${sec}`;
}

function computeObjectiveTimers(gameTimeSec: number, events: Array<any>) {
  const DRAGON_FIRST_SPAWN = 300; // 5:00
  const DRAGON_RESPAWN = 300; // 5:00
  const HERALD_FIRST_SPAWN = 480; // 8:00
  const HERALD_RESPAWN = 360; // 6:00 (until 20:00)
  const BARON_FIRST_SPAWN = 1200; // 20:00
  const BARON_RESPAWN = 360; // 6:00

  let lastDragonKill: any | null = null;
  let lastHeraldKill: any | null = null;
  let lastBaronKill: any | null = null;

  for (const ev of events || []) {
    if (ev.EventName === "DragonKill") lastDragonKill = ev;
    if (ev.EventName === "HeraldKill") lastHeraldKill = ev;
    if (ev.EventName === "BaronKill") lastBaronKill = ev;
  }

  const nextDragonAt =
    gameTimeSec < DRAGON_FIRST_SPAWN
      ? DRAGON_FIRST_SPAWN
      : lastDragonKill
      ? lastDragonKill.EventTime + DRAGON_RESPAWN
      : DRAGON_FIRST_SPAWN;

  const heraldAvailableWindowEnd = BARON_FIRST_SPAWN;
  const nextHeraldAt =
    gameTimeSec < HERALD_FIRST_SPAWN
      ? HERALD_FIRST_SPAWN
      : Math.min(
          heraldAvailableWindowEnd,
          lastHeraldKill
            ? lastHeraldKill.EventTime + HERALD_RESPAWN
            : HERALD_FIRST_SPAWN
        );

  const nextBaronAt =
    gameTimeSec < BARON_FIRST_SPAWN
      ? BARON_FIRST_SPAWN
      : lastBaronKill
      ? lastBaronKill.EventTime + BARON_RESPAWN
      : BARON_FIRST_SPAWN;

  return {
    dragon: {
      nextSpawnTime: nextDragonAt,
      timeToSpawn: secondsToClock(nextDragonAt - gameTimeSec),
      lastKillType: lastDragonKill?.DragonType || null,
    },
    herald: {
      nextSpawnTime: nextHeraldAt,
      timeToSpawn: secondsToClock(nextHeraldAt - gameTimeSec),
      despawnsAt: heraldAvailableWindowEnd,
      despawnsIn: secondsToClock(heraldAvailableWindowEnd - gameTimeSec),
    },
    baron: {
      nextSpawnTime: nextBaronAt,
      timeToSpawn: secondsToClock(nextBaronAt - gameTimeSec),
    },
  };
}

export async function getAggregatedSnapshot(): Promise<AggregatedSnapshot> {
  // Lazy import Data Dragon helpers to avoid any cyclic/bundle issues
  const ddragon = await import("./datadragon");
  // Core datasets (Riot docs: Live Client Data API)
  // https://developer.riotgames.com/docs/lol (Live Client Data API)
  const [gameStats, eventsWrap, activePlayerName, playersRaw] =
    await Promise.all([
      getJson<any>("/liveclientdata/gamestats"),
      getJson<any>("/liveclientdata/eventdata").then((d) => d.Events || []),
      getJson<
        | string
        | { riotId?: string; riotIdGameName?: string; riotIdTagLine?: string }
      >("/liveclientdata/activeplayername"),
      getJson<Array<any> | any>("/liveclientdata/playerlist"),
    ]);

  const events: Array<any> = eventsWrap;
  // Coerce players to a safe array to avoid "is not iterable" scenarios when not in a game
  const players: Array<any> = Array.isArray(playersRaw) ? playersRaw : [];

  // Normalize active player identity (supports legacy and RiotID formats)
  const apIsString = typeof activePlayerName === "string";
  const apString: string = apIsString ? (activePlayerName as string) : "";
  const apRiotIdFromString = apString.includes("#") ? apString : "";
  const apGameNameFromString = apRiotIdFromString
    ? apRiotIdFromString.split("#")[0]
    : apString;
  const apTagFromString = apRiotIdFromString
    ? apRiotIdFromString.split("#")[1]
    : "";
  const apGameName =
    (!apIsString && activePlayerName?.riotIdGameName) ||
    apGameNameFromString ||
    "";
  const apTagLine =
    (!apIsString && activePlayerName?.riotIdTagLine) || apTagFromString || "";
  const apFullRiotId =
    (!apIsString && activePlayerName?.riotId) ||
    (apGameName && apTagLine ? `${apGameName}#${apTagLine}` : "");

  const myName = apGameName;

  function normalizeIdString(s: string | null | undefined): string {
    return (s || "").trim().toLowerCase();
  }
  function buildFullRiotId(p: any): string {
    // Prefer explicit riotId if provided
    if (typeof p?.riotId === "string" && p.riotId.includes("#"))
      return p.riotId;
    // Compose from gameName + tag if present
    if (p?.riotIdGameName && p?.riotIdTagLine) {
      return `${p.riotIdGameName}#${p.riotIdTagLine}`;
    }
    // Legacy single-name fallback
    return p?.summonerName || "";
  }

  let me: any | null = null;
  for (const p of players) {
    const pFull = buildFullRiotId(p);
    // Match against the richest identifier first (full riot id)
    if (
      apFullRiotId &&
      normalizeIdString(pFull) === normalizeIdString(apFullRiotId)
    ) {
      me = p;
      break;
    }
    // Fallback: match gameName + tag when both present
    if (
      !me &&
      apGameName &&
      apTagLine &&
      normalizeIdString(p.riotIdGameName) === normalizeIdString(apGameName) &&
      normalizeIdString(p.riotIdTagLine) === normalizeIdString(apTagLine)
    ) {
      me = p;
    }
    // Fallback: match by gameName only (may collide in rare cases)
    if (
      !me &&
      apGameName &&
      normalizeIdString(p.riotIdGameName) === normalizeIdString(apGameName)
    ) {
      me = p;
    }
    // Legacy fallback: match by summonerName if provided
    if (
      !me &&
      apString &&
      !apRiotIdFromString &&
      normalizeIdString(p.summonerName) === normalizeIdString(apString)
    ) {
      me = p;
    }
  }
  if (!me && players.length) me = players[0];

  // Prepare riotId candidates (full RiotID, gameName#tag, gameName, legacy summonerName, active string)
  const riotIdCandidates = Array.from(
    new Set(
      [
        apFullRiotId,
        buildFullRiotId(me),
        me?.riotIdGameName && me?.riotIdTagLine
          ? `${me.riotIdGameName}#${me.riotIdTagLine}`
          : "",
        me?.riotIdGameName || "",
        me?.summonerName || "",
        apString || "",
      ]
        .filter(Boolean)
        .map((s) => (s as string).trim())
    )
  ) as string[];

  async function fetchWithRiotIdFallback<T>(
    buildPath: (id: string) => string
  ): Promise<{ data: T | null; usedId: string | null }> {
    for (const id of riotIdCandidates) {
      try {
        const data = await getJson<T>(buildPath(id));
        return { data, usedId: id };
      } catch {
        // try next candidate
      }
    }
    return { data: null, usedId: null };
  }

  const [activePlayer, myScores, myItems, mySpells, myRunes, myAbilities] =
    await Promise.all([
      getJson<any>("/liveclientdata/activeplayer").catch(() => null),
      // Scores/items/spells/runes with riotId fallbacks
      (async () => {
        const res = await fetchWithRiotIdFallback<any>(
          (id) =>
            `/liveclientdata/playerscores?riotId=${encodeURIComponent(id)}`
        );
        // Attach the resolved id on the function object for later read
        (res as any).__usedId = res.usedId;
        return res.data;
      })(),
      (async () => {
        const res = await fetchWithRiotIdFallback<any>(
          (id) => `/liveclientdata/playeritems?riotId=${encodeURIComponent(id)}`
        );
        (res as any).__usedId = res.usedId;
        // API returns array directly, but handle both cases
        let items = res.data;
        if (
          items &&
          !Array.isArray(items) &&
          items.data &&
          Array.isArray(items.data)
        ) {
          items = items.data;
        }
        if (!Array.isArray(items)) {
          items = [];
        }
        return items;
      })(),
      (async () => {
        const res = await fetchWithRiotIdFallback<any>(
          (id) =>
            `/liveclientdata/playersummonerspells?riotId=${encodeURIComponent(
              id
            )}`
        );
        (res as any).__usedId = res.usedId;
        return res.data;
      })(),
      (async () => {
        const res = await fetchWithRiotIdFallback<any>(
          (id) =>
            `/liveclientdata/playermainrunes?riotId=${encodeURIComponent(id)}`
        );
        (res as any).__usedId = res.usedId;
        return res.data;
      })(),
      // Not always documented, but widely present for active player:
      getJson<any>("/liveclientdata/activeplayerabilities").catch(() => null),
    ]);

  // Determine which candidate actually worked (prefer the one from items → most visible to user)
  let resolvedRiotId: string | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rItems = myItems as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rScores = myScores as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rSpells = mySpells as any;
    resolvedRiotId =
      (rItems && rItems.__usedId) ||
      (rScores && rScores.__usedId) ||
      (rSpells && rSpells.__usedId) ||
      null;
  } catch {
    // ignore
  }

  const objectiveTimers = computeObjectiveTimers(gameStats.gameTime, events);

  // Build name->team map for event attribution
  const nameToTeam = new Map<string, string>();
  for (const p of players) {
    if (p.riotIdGameName) nameToTeam.set(p.riotIdGameName, p.team || "");
    if (p.summonerName) nameToTeam.set(p.summonerName, p.team || "");
  }
  const myTeam = me?.team || "";
  const otherTeams = new Set<string>(
    players.map((p: any) => p.team).filter((t: string) => t && t !== myTeam)
  );
  const enemyTeam = otherTeams.size ? Array.from(otherTeams)[0] : null;

  // Tally events for team scores and structures
  let teamKills = 0;
  let enemyKills = 0;
  let myTurrets = 0;
  let enemyTurrets = 0;
  let myInhibs = 0;
  let enemyInhibs = 0;
  for (const ev of events) {
    if (ev.EventName === "ChampionKill" && ev.KillerName) {
      const killerTeam = nameToTeam.get(ev.KillerName) || "";
      if (killerTeam === myTeam) teamKills++;
      else if (enemyTeam && killerTeam === enemyTeam) enemyKills++;
    }
    if (ev.EventName === "TurretKilled") {
      // If KillerName available, attribute; otherwise best-effort by using shutdown team if present
      const killerTeam = ev.KillerName
        ? nameToTeam.get(ev.KillerName) || ""
        : "";
      if (killerTeam === myTeam) myTurrets++;
      else if (enemyTeam && killerTeam === enemyTeam) enemyTurrets++;
    }
    if (ev.EventName === "InhibKilled") {
      const killerTeam = ev.KillerName
        ? nameToTeam.get(ev.KillerName) || ""
        : "";
      if (killerTeam === myTeam) myInhibs++;
      else if (enemyTeam && killerTeam === enemyTeam) enemyInhibs++;
    }
  }

  // Derived
  const minutes = Math.max(1 / 60, gameStats.gameTime / 60);
  const kda = `${myScores?.kills ?? 0}/${myScores?.deaths ?? 0}/${
    myScores?.assists ?? 0
  }`;
  const csPerMin = Number(((myScores?.creepScore ?? 0) / minutes).toFixed(2));
  const visionPerMin = Number(
    ((myScores?.wardScore ?? 0) / minutes).toFixed(2)
  );

  // Data Dragon assets (icons)
  let assets: AggregatedSnapshot["assets"] | undefined;
  let version: string | null = null;
  try {
    version = await ddragon.getLatestVersion();
  } catch (e) {
    console.error(
      "[getAggregatedSnapshot] Failed to get Data Dragon version:",
      e
    );
  }

  if (version) {
    // Build each piece independently so one failure doesn't nuke the rest
    let championIconUrl: string | null = null;
    try {
      const champIndex = await ddragon
        .ensureChampionIndex()
        .catch(() => new Map<string, string>());
      const champId =
        champIndex.get(me?.championName || "") ||
        (me?.championName ? me.championName.replace(/\s|[^A-Za-z]/g, "") : "");
      championIconUrl = champId
        ? ddragon.buildChampionSquareUrl(version, champId)
        : null;
    } catch (e) {
      console.error(
        "[getAggregatedSnapshot] Failed to build champion icon:",
        e
      );
      championIconUrl = null;
    }

    const itemIconUrlsBySlot: (string | null)[] = Array(7).fill(null);
    try {
      if (myItems && Array.isArray(myItems)) {
        for (const item of myItems) {
          const slot = typeof item.slot === "number" ? item.slot : -1;
          if (slot >= 0 && slot <= 6 && item.itemID) {
            itemIconUrlsBySlot[slot] = ddragon.buildItemIconUrl(
              version,
              item.itemID
            );
          }
        }
      }
    } catch (e) {
      console.error("[getAggregatedSnapshot] Failed to build item icons:", e);
    }
    const itemIconUrls = itemIconUrlsBySlot;

    let runeIcons = {
      keystone: null as string | null,
      primaryTree: null as string | null,
      secondaryTree: null as string | null,
    };
    try {
      const runeIndex = await ddragon.ensureRunesIndex();
      const keystoneId: number | undefined = myRunes?.keystone?.id;
      const primaryTreeId: number | undefined = myRunes?.primaryRuneTree?.id;
      const secondaryTreeId: number | undefined =
        myRunes?.secondaryRuneTree?.id;
      const keystoneIcon = keystoneId ? runeIndex.get(keystoneId) : null;
      const primaryTreeIcon = primaryTreeId
        ? runeIndex.get(primaryTreeId)
        : null;
      const secondaryTreeIcon = secondaryTreeId
        ? runeIndex.get(secondaryTreeId)
        : null;
      runeIcons = {
        keystone: keystoneIcon ? ddragon.buildRuneIconUrl(keystoneIcon) : null,
        primaryTree: primaryTreeIcon
          ? ddragon.buildRuneIconUrl(primaryTreeIcon)
          : null,
        secondaryTree: secondaryTreeIcon
          ? ddragon.buildRuneIconUrl(secondaryTreeIcon)
          : null,
      };
    } catch (e) {
      console.error("[getAggregatedSnapshot] Failed to build rune icons:", e);
    }

    assets = { version, championIconUrl, itemIconUrls, runeIcons };
  } else {
    console.warn(
      "[getAggregatedSnapshot] No version available, skipping assets"
    );
  }

  const snapshot: AggregatedSnapshot = {
    error: false,
    game: {
      mode: gameStats.gameMode,
      modeName: resolveGameModeName(gameStats.gameMode),
      time: gameStats.gameTime,
    },
    player: {
      name: apFullRiotId || apString || myName,
      riotId: resolvedRiotId,
      champion: me?.championName || "",
      team: me?.team || "",
      level: me?.level || 0,
    },
    runes: {
      keystone: myRunes?.keystone?.displayName || "",
      primaryTree: myRunes?.primaryRuneTree?.displayName || "",
      secondaryTree: myRunes?.secondaryRuneTree?.displayName || "",
    },
    stats: {
      kills: myScores?.kills ?? 0,
      deaths: myScores?.deaths ?? 0,
      assists: myScores?.assists ?? 0,
      cs: myScores?.creepScore ?? 0,
      vision: myScores?.wardScore ?? 0,
    },
    derived: {
      kda,
      csPerMin,
      visionPerMin,
    },
    team: {
      myTeam,
      enemyTeam,
      kills: teamKills,
      enemyKills,
      turrets: { myTeam: myTurrets, enemyTeam: enemyTurrets },
      inhibs: { myTeam: myInhibs, enemyTeam: enemyInhibs },
    },
    // Build items array indexed by slot (0-6), preserving slot order
    items: (() => {
      const itemsBySlot: (string | null)[] = Array(7).fill(null);
      if (myItems && Array.isArray(myItems)) {
        // Sort by slot to ensure correct order
        const sorted = [...myItems].sort(
          (a: any, b: any) => (a.slot || 0) - (b.slot || 0)
        );
        for (const item of sorted) {
          const slot = typeof item.slot === "number" ? item.slot : -1;
          if (slot >= 0 && slot <= 6 && item.displayName) {
            itemsBySlot[slot] = item.displayName;
          }
        }
      } else {
        console.warn(
          "[getAggregatedSnapshot] myItems is not an array:",
          myItems
        );
      }
      return itemsBySlot;
    })(),
    spells: {
      d: mySpells?.summonerSpellOne?.displayName || "",
      f: mySpells?.summonerSpellTwo?.displayName || "",
    },
    abilities: {
      q: myAbilities?.Q ? { name: myAbilities.Q.displayName || "Q" } : null,
      w: myAbilities?.W ? { name: myAbilities.W.displayName || "W" } : null,
      e: myAbilities?.E ? { name: myAbilities.E.displayName || "E" } : null,
      r: myAbilities?.R ? { name: myAbilities.R.displayName || "R" } : null,
    },
    objectives: objectiveTimers,
    assets,
    raw: {
      gameStats,
      events,
    },
  };
  return snapshot;
}

export async function getRawDump(): Promise<Record<string, any>> {
  const [gameStats, eventsWrap, activePlayerName, playersRaw, allGameData] =
    await Promise.all([
      getJson<any>("/liveclientdata/gamestats").catch((e) => ({
        error: String(e),
      })),
      getJson<any>("/liveclientdata/eventdata")
        .then((d) => d.Events || [])
        .catch((e) => ({ error: String(e) })),
      getJson<
        | string
        | { riotId?: string; riotIdGameName?: string; riotIdTagLine?: string }
      >("/liveclientdata/activeplayername").catch((e) => ({
        error: String(e),
      })),
      getJson<Array<any> | any>("/liveclientdata/playerlist").catch((e) => ({
        error: String(e),
      })),
      getJson<any>("/liveclientdata/allgamedata").catch((e) => ({
        error: String(e),
      })),
    ]);

  const players: Array<any> = Array.isArray(playersRaw) ? playersRaw : [];

  const apIsString = typeof activePlayerName === "string";
  const apString: string = apIsString ? (activePlayerName as string) : "";
  const apRiotIdFromString = apString.includes("#") ? apString : "";
  const apGameNameFromString = apRiotIdFromString
    ? apRiotIdFromString.split("#")[0]
    : apString;
  const apTagFromString = apRiotIdFromString
    ? apRiotIdFromString.split("#")[1]
    : "";
  const apGameName =
    (!apIsString && (activePlayerName as any)?.riotIdGameName) ||
    apGameNameFromString ||
    "";
  const apTagLine =
    (!apIsString && (activePlayerName as any)?.riotIdTagLine) ||
    apTagFromString ||
    "";
  const apFullRiotId =
    (!apIsString && (activePlayerName as any)?.riotId) ||
    (apGameName && apTagLine ? `${apGameName}#${apTagLine}` : "");

  function buildFullRiotId(p: any): string {
    if (typeof p?.riotId === "string" && p.riotId.includes("#"))
      return p.riotId;
    if (p?.riotIdGameName && p?.riotIdTagLine) {
      return `${p.riotIdGameName}#${p.riotIdTagLine}`;
    }
    return p?.summonerName || "";
  }

  const me =
    players.find((p) => buildFullRiotId(p) === apFullRiotId) ||
    players.find(
      (p) => p.riotIdGameName === apGameName && p.riotIdTagLine === apTagLine
    ) ||
    players.find((p) => p.riotIdGameName === apGameName) ||
    players.find((p) => p.summonerName === apString) ||
    players[0] ||
    null;

  const myRiotId = me ? buildFullRiotId(me) : null;

  type FetchLog<T> = {
    data: T | null;
    usedUrl: string | null;
    attempted: string[];
  };
  async function fetchWithRiotIdFallbackLogged<T>(
    buildPath: (id: string) => string,
    candidates: string[]
  ): Promise<FetchLog<T>> {
    const attempted: string[] = [];
    for (const id of candidates) {
      const path = buildPath(id);
      attempted.push(path);
      try {
        const data = await getJson<T>(path);
        return { data, usedUrl: path, attempted };
      } catch {
        // try next
      }
    }
    return { data: null, usedUrl: null, attempted };
  }

  const riotIdCandidates = Array.from(
    new Set(
      [
        myRiotId,
        apFullRiotId,
        me?.riotIdGameName && me?.riotIdTagLine
          ? `${me.riotIdGameName}#${me.riotIdTagLine}`
          : "",
        me?.riotIdGameName || "",
        me?.summonerName || "",
        apString || "",
      ]
        .filter(Boolean)
        .map((s) => (s as string).trim())
    )
  ) as string[];

  const [activePlayer, scoresLog, itemsLog, spellsLog, myAbilities, runesLog] =
    await Promise.all([
      getJson<any>("/liveclientdata/activeplayer").catch((e) => ({
        error: String(e),
      })),
      fetchWithRiotIdFallbackLogged<any>(
        (id) => `/liveclientdata/playerscores?riotId=${encodeURIComponent(id)}`,
        riotIdCandidates
      ),
      fetchWithRiotIdFallbackLogged<any[]>(
        (id) => `/liveclientdata/playeritems?riotId=${encodeURIComponent(id)}`,
        riotIdCandidates
      ),
      fetchWithRiotIdFallbackLogged<any>(
        (id) =>
          `/liveclientdata/playersummonerspells?riotId=${encodeURIComponent(
            id
          )}`,
        riotIdCandidates
      ),
      getJson<any>("/liveclientdata/activeplayerabilities").catch((e) => ({
        error: String(e),
      })),
      fetchWithRiotIdFallbackLogged<any>(
        (id) =>
          `/liveclientdata/playermainrunes?riotId=${encodeURIComponent(id)}`,
        riotIdCandidates
      ),
    ]);

  return {
    meta: {
      resolvedMyRiotId: myRiotId,
      resolvedPlayer: me,
      riotIdCandidates,
    },
    endpoints: {
      allgamedata: { url: "/liveclientdata/allgamedata", data: allGameData },
      gamestats: { url: "/liveclientdata/gamestats", data: gameStats },
      eventdata: { url: "/liveclientdata/eventdata", data: eventsWrap },
      activeplayername: {
        url: "/liveclientdata/activeplayername",
        data: activePlayerName,
      },
      playerlist: { url: "/liveclientdata/playerlist", data: playersRaw },
      activeplayer: { url: "/liveclientdata/activeplayer", data: activePlayer },
      activeplayerabilities: {
        url: "/liveclientdata/activeplayerabilities",
        data: myAbilities,
      },
      playermainrunes: {
        usedUrl: runesLog.usedUrl,
        attempted: runesLog.attempted,
        data: runesLog.data,
      },
      playerscores: {
        usedUrl: scoresLog.usedUrl,
        attempted: scoresLog.attempted,
        data: scoresLog.data,
      },
      playeritems: {
        usedUrl: itemsLog.usedUrl,
        attempted: itemsLog.attempted,
        data: itemsLog.data,
      },
      playersummonerspells: {
        usedUrl: spellsLog.usedUrl,
        attempted: spellsLog.attempted,
        data: spellsLog.data,
      },
    },
  };
}
