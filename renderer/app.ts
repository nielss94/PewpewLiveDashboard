(() => {
  type Ability = { name: string } | null;
  type Snapshot = {
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
    abilities: { q: Ability; w: Ability; e: Ability; r: Ability };
    objectives: {
      dragon: { timeToSpawn: string; lastKillType: string | null };
      herald: { timeToSpawn: string; despawnsIn: string };
      baron: { timeToSpawn: string };
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
    raw?: {
      gameStats: any;
      events: Array<any>;
    };
  };

  const { createApp, ref, onMounted, computed, watch } = (window as any).Vue;

  function fmtClock(seconds: number): string {
    const s = Math.floor(seconds);
    const m = Math.floor(s / 60);
    const sec = (s % 60).toString().padStart(2, "0");
    return `${m}:${sec}`;
  }

  createApp({
    setup() {
      const snapshot = ref(null as Snapshot | null);
      const pollMs = ref(1000 as number);
      const isDev = ref(false as boolean);
      const appVersion = ref("" as string);
      const debugOpen = ref(false as boolean);
      const activeTab = ref("home" as "home" | "live");
      const toasts = ref(
        [] as Array<{
          id: string;
          title: string;
          body?: string;
          icon?: string;
          severity: "info" | "warning" | "critical";
          until: number;
        }>
      );
      type Notif = {
        id: string;
        title: string;
        body?: string;
        icon?: string;
        severity: "info" | "warning" | "critical";
        at: number;
        category: "wave" | "macro" | "other";
      };
      const notifications = ref([] as Array<Notif>);

      function cd(ab: Ability): string {
        if (!ab) return "—";
        return `${ab.name}`;
      }

      async function applyPoll() {
        await (window as any).api.setPollingInterval(pollMs.value);
      }

      async function openRaw() {
        await (window as any).api.openRawWindow();
      }

      onMounted(async () => {
        const settings = await (window as any).api.getSettings();
        pollMs.value = settings.pollIntervalMs ?? 1000;
        isDev.value = !!settings.isDev;
        appVersion.value = String(settings.version || "");

        const s = await (window as any).api.getSnapshot();
        if (s) {
          snapshot.value = s;
          previousHasData.value = hasData.value;
          // Load teams if already in game
          if (hasData.value) {
            void loadRawDump();
            // Ensure overlay is visible if already in game at startup
            try {
              await (window as any).api.showOverlay();
            } catch {}
          }
        }
        (window as any).api.onSnapshot((data: Snapshot) => {
          const wasInGame = hasData.value;
          snapshot.value = data;
          // Auto-switch to live game tab when game starts
          if (hasData.value && !wasInGame) {
            activeTab.value = "live";
            // Auto-open overlay when entering a live game
            try {
              void (window as any).api.showOverlay();
            } catch {}
          } else if (!hasData.value && wasInGame) {
            // Game ended or connection lost → hide overlay
            try {
              void (window as any).api.hideOverlay();
            } catch {}
          }
          previousHasData.value = hasData.value;
          // Reload teams when snapshot updates (in case players changed)
          if (hasData.value) {
            void loadRawDump();
          }
        });
        // Subscribe to tips
        if ((window as any).api?.onTip) {
          (window as any).api.onTip((tip: any) => {
            const stickyMs =
              typeof tip?.stickyMs === "number" && tip.stickyMs > 0
                ? tip.stickyMs
                : 4000;
            const until = Date.now() + stickyMs;
            const severity =
              tip?.severity === "warning" || tip?.severity === "critical"
                ? tip.severity
                : "info";
            const idStr = String(tip?.id || Math.random());
            // Derive simple category for UI split
            const category: "wave" | "macro" | "other" =
              tip?.metadata && typeof tip.metadata === "object"
                ? typeof (tip.metadata as any).waveIndex === "number"
                  ? "wave"
                  : typeof (tip.metadata as any).objective === "string"
                  ? "macro"
                  : "other"
                : "other";
            // Normalize title/body so popups always have a visible title
            let toastTitle = String(tip?.title || "").trim();
            const toastBodyRaw = tip?.body ? String(tip.body) : "";
            const toastBody = toastBodyRaw ? toastBodyRaw.trim() : "";
            if (!toastTitle && toastBody) {
              toastTitle =
                toastBody.length > 80
                  ? toastBody.slice(0, 80) + "…"
                  : toastBody;
            }
            if (!toastTitle) toastTitle = "Notification";
            const toast = {
              id: idStr,
              title: toastTitle,
              body: toastBody || undefined,
              icon: tip?.icon ? String(tip.icon) : undefined,
              severity,
              until,
            };
            toasts.value.push(toast);

            // Notifications list entry (ensure non-empty title too)
            let notifTitle = String(tip?.title || "").trim();
            const notifBodyRaw = tip?.body ? String(tip.body) : "";
            const notifBody = notifBodyRaw ? notifBodyRaw.trim() : "";
            if (!notifTitle && notifBody) {
              notifTitle =
                notifBody.length > 80
                  ? notifBody.slice(0, 80) + "…"
                  : notifBody;
            }
            if (!notifTitle) notifTitle = "Notification";
            notifications.value.unshift({
              id: idStr + "-" + until,
              title: notifTitle,
              body: notifBody || undefined,
              icon: tip?.icon ? String(tip.icon) : undefined,
              severity,
              at: Date.now(),
              category,
            });
            // cap history
            if (notifications.value.length > 100) {
              notifications.value.length = 100;
            }
          });
        }
      });

      // Prune expired toasts (always run, not just when tips are available)
      setInterval(() => {
        const now = Date.now();
        toasts.value = toasts.value.filter(
          (t: { until: number }) => t.until > now
        );
      }, 1000);

      async function sendTestTip() {
        try {
          await (window as any).api.emitTestTip({
            id: "test_tip",
            title: "Test Notification",
            body: "If you see this, notifications are wired up.",
            icon: "🔔",
            severity: "warning",
            stickyMs: 5000,
          });
        } catch {
          // ignore
        }
      }

      const hasData = computed(() => {
        return !!snapshot.value && !snapshot.value.error;
      });

      // Auto-switch to live game tab when game starts
      const previousHasData = ref(false);

      // Items: separate regular items (0-5) and trinket (6)
      // items array is always 7 items indexed by slot (0-6)
      const regularItems = computed(() => {
        if (!snapshot.value?.items) {
          return Array(6).fill(null);
        }
        const items = snapshot.value.items.slice(0, 6);
        return items;
      });

      const trinketItem = computed(() => {
        if (!snapshot.value?.items) return null;
        // Item at index 6 is the trinket (slot 6)
        return snapshot.value.items[6] || null;
      });

      // Spell icon URLs
      const spellIconUrls = computed(() => {
        if (!snapshot.value?.assets?.version || !snapshot.value?.spells) {
          return { d: null, f: null };
        }
        const version = snapshot.value.assets.version;
        function mapSpellToKey(name: string): string | null {
          const map: Record<string, string> = {
            Flash: "SummonerFlash",
            Ignite: "SummonerDot",
            Ghost: "SummonerHaste",
            Heal: "SummonerHeal",
            Exhaust: "SummonerExhaust",
            Teleport: "SummonerTeleport",
            "Unleashed Teleport": "SummonerTeleport",
            Barrier: "SummonerBarrier",
            Cleanse: "SummonerBoost",
            Smite: "SummonerSmite",
            "Challenging Smite": "SummonerSmite",
            "Chilling Smite": "SummonerSmite",
            Clarity: "SummonerMana",
            Mark: "SummonerSnowball",
          };
          if (map[name]) return map[name];
          const n = (name || "").toLowerCase();
          if (n.includes("teleport")) return "SummonerTeleport";
          if (n.includes("smite")) return "SummonerSmite";
          return null;
        }
        const keyD = mapSpellToKey(snapshot.value.spells.d);
        const keyF = mapSpellToKey(snapshot.value.spells.f);
        return {
          d: keyD
            ? `https://ddragon.leagueoflegends.com/cdn/${version}/img/spell/${keyD}.png`
            : null,
          f: keyF
            ? `https://ddragon.leagueoflegends.com/cdn/${version}/img/spell/${keyF}.png`
            : null,
        };
      });

      // Event log
      const eventLog = computed(() => {
        if (!snapshot.value?.raw?.events) return [];
        const list = snapshot.value.raw.events;
        const recent = list.slice(-30).reverse();
        const out: Array<{ icon: string; time: string; text: string }> = [];
        for (const ev of recent) {
          const t =
            typeof ev.EventTime === "number" ? fmtClock(ev.EventTime) : "";
          let icon = "•";
          let text = ev.EventName || "Event";
          if (ev.EventName === "ChampionKill") {
            icon = "⚔";
            text = `${ev.KillerName || "?"} killed ${ev.VictimName || "?"}`;
          } else if (ev.EventName === "Multikill") {
            icon = "🔥";
            text = `${ev.KillerName || "?"} ${ev.KillStreak || ""}x kill`;
          } else if (ev.EventName === "Ace") {
            icon = "🃏";
            text = `${ev.AcingTeam || ""} Ace`;
          } else if (ev.EventName === "TurretKilled") {
            icon = "🏰";
            text = `Turret destroyed (${ev.KillerName || "Unknown"})`;
          } else if (ev.EventName === "FirstBlood") {
            icon = "💉";
            text = `First Blood: ${ev.Recipient || ""}`;
          } else if (ev.EventName === "GameStart") {
            icon = "▶";
            text = "Game Start";
          } else if (ev.EventName === "MinionsSpawning") {
            icon = "👥";
            text = "Minions Spawning";
          }
          out.push({ icon, time: t, text });
        }
        return out;
      });

      // Split notifications into macro vs wave
      const waveNotifs = computed(() =>
        notifications.value.filter((n: Notif) => n.category === "wave")
      );
      const macroNotifs = computed(() =>
        notifications.value.filter(
          (n: Notif) => n.category === "macro" || n.category === "other"
        )
      );

      // Insights (KDA, CS/Min, etc.)
      const insights = computed(() => {
        if (!snapshot.value) return { kda: "", csPerMin: "", kpPerMin: "" };
        const k = snapshot.value.stats.kills || 0;
        const d = snapshot.value.stats.deaths || 0;
        const a = snapshot.value.stats.assists || 0;
        const cs = snapshot.value.stats.cs || 0;
        const minutes = snapshot.value.game.time
          ? Math.max(1 / 60, snapshot.value.game.time / 60)
          : 0;
        return {
          kda: d === 0 ? `${k + a}/0` : `${((k + a) / d).toFixed(2)} KDA`,
          csPerMin: minutes ? `${(cs / minutes).toFixed(2)} CS/Min` : "",
          kpPerMin: minutes ? `${((k + a) / minutes).toFixed(2)} K+A/Min` : "",
        };
      });

      // Raw dump for teams (will be loaded separately)
      const rawDump = ref(null as any);
      const teams = ref({
        my: [] as Array<any>,
        enemy: [] as Array<any>,
      });

      async function buildTeams(dump: any) {
        try {
          const players = dump?.endpoints?.allgamedata?.data?.allPlayers || [];
          if (!players.length) {
            teams.value.my = [];
            teams.value.enemy = [];
            return;
          }
          const myTeam = snapshot.value?.player.team || players[0]?.team;
          // Get version from snapshot or fetch it from Data Dragon
          let version = snapshot.value?.assets?.version;
          if (!version) {
            try {
              const res = await fetch(
                "https://ddragon.leagueoflegends.com/api/versions.json"
              );
              const versions = await res.json();
              version = versions[0];
            } catch {
              console.error("Failed to get version for teams");
              return;
            }
          }

          // Build champion index
          let champIndex: Record<string, string> = {};
          try {
            const res = await fetch(
              `https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/champion.json`
            );
            const json = await res.json();
            for (const key of Object.keys(json.data)) {
              const c = json.data[key];
              champIndex[c.name] = c.id;
            }
          } catch {}

          function mapSpellToKey(name: string): string | null {
            const map: Record<string, string> = {
              Flash: "SummonerFlash",
              Ignite: "SummonerDot",
              Ghost: "SummonerHaste",
              Heal: "SummonerHeal",
              Exhaust: "SummonerExhaust",
              Teleport: "SummonerTeleport",
              "Unleashed Teleport": "SummonerTeleport",
              Barrier: "SummonerBarrier",
              Cleanse: "SummonerBoost",
              Smite: "SummonerSmite",
              "Challenging Smite": "SummonerSmite",
              "Chilling Smite": "SummonerSmite",
              Clarity: "SummonerMana",
              Mark: "SummonerSnowball",
            };
            if (map[name]) return map[name];
            const n = (name || "").toLowerCase();
            if (n.includes("teleport")) return "SummonerTeleport";
            if (n.includes("smite")) return "SummonerSmite";
            return null;
          }

          function enrich(p: any) {
            const cName = p.championName || "";
            const cId =
              champIndex[cName] ||
              (cName ? cName.replace(/\s|[^A-Za-z]/g, "") : "");
            return {
              name: p.riotId || p.summonerName,
              team: p.team,
              champion: cName,
              championIcon: cId
                ? `https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${cId}.png`
                : "",
              level: p.level,
              k: p.scores?.kills ?? 0,
              d: p.scores?.deaths ?? 0,
              a: p.scores?.assists ?? 0,
              cs: p.scores?.creepScore ?? 0,
              items: (p.items || []).map((i: any) => ({
                id: i.itemID,
                name: i.displayName,
                icon: `https://ddragon.leagueoflegends.com/cdn/${version}/img/item/${i.itemID}.png`,
                tooltip: `${i.displayName} • Slot ${i.slot} • Count ${i.count} • Price ${i.price}`,
              })),
              spells: {
                d: p.summonerSpells?.summonerSpellOne?.displayName || "",
                f: p.summonerSpells?.summonerSpellTwo?.displayName || "",
                dIcon: (() => {
                  const key = mapSpellToKey(
                    p.summonerSpells?.summonerSpellOne?.displayName || ""
                  );
                  return key
                    ? `https://ddragon.leagueoflegends.com/cdn/${version}/img/spell/${key}.png`
                    : "";
                })(),
                fIcon: (() => {
                  const key = mapSpellToKey(
                    p.summonerSpells?.summonerSpellTwo?.displayName || ""
                  );
                  return key
                    ? `https://ddragon.leagueoflegends.com/cdn/${version}/img/spell/${key}.png`
                    : "";
                })(),
              },
            };
          }

          const mine: any[] = [];
          const enemy: any[] = [];
          for (const p of players) {
            const ep = enrich(p);
            if (p.team === myTeam) mine.push(ep);
            else enemy.push(ep);
          }
          teams.value.my = mine;
          teams.value.enemy = enemy;
        } catch (e) {
          console.error("Failed to build teams:", e);
          teams.value.my = [];
          teams.value.enemy = [];
        }
      }

      async function loadRawDump() {
        try {
          const dump = await (window as any).api.getRawDump();
          if (!dump) {
            console.warn("Raw dump is null or undefined");
            return;
          }
          rawDump.value = dump;
          await buildTeams(dump);
        } catch (e) {
          console.error("Failed to load raw dump:", e);
          teams.value.my = [];
          teams.value.enemy = [];
        }
      }

      return {
        snapshot,
        pollMs,
        isDev,
        debugOpen,
        activeTab,
        sendTestTip,
        toasts,
        notifications,
        applyPoll,
        openRaw,
        appVersion,
        toggleOverlay: async () => {
          try {
            await (window as any).api.toggleOverlay();
          } catch {}
        },
        fmtClock,
        cd,
        hasData,
        waveNotifs,
        macroNotifs,
        regularItems,
        trinketItem,
        spellIconUrls,
        eventLog,
        insights,
        teams,
        loadRawDump,
      };
    },
  }).mount("#app");
})();
