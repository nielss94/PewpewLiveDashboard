(() => {
  const { createApp, ref, onMounted } = (window as any).Vue;

  createApp({
    setup() {
      const meta = ref({} as any);
      const endpoints = ref({} as Record<string, any>);
      const errorMsg = ref("");
      const auto = ref(true);
      const intervalMs = ref(1000);
      let timer: any = null;
      const summary = ref({
        game: { mode: "", time: "", map: "" },
        me: {
          riotId: "",
          champion: "",
          championIcon: "",
          level: null as number | null,
        },
        scores: {
          kills: null as number | null,
          deaths: null as number | null,
          assists: null as number | null,
          cs: null as number | null,
          vision: null as number | null,
        },
        items: [] as Array<{
          id: number;
          name: string;
          icon: string;
          tooltip: string;
        }>,
        spells: { d: "", f: "", dIcon: "", fIcon: "" },
        stats: {
          ad: null as number | null,
          ap: null as number | null,
          armor: null as number | null,
          mr: null as number | null,
          as: null as number | null,
          haste: null as number | null,
          ms: null as number | null,
          hp: null as number | null,
          mp: null as number | null,
          tenacity: null as number | null,
        },
        runes: {
          keystoneName: "",
          keystoneIcon: "",
          primaryTreeName: "",
          primaryTreeIcon: "",
          secondaryTreeName: "",
          secondaryTreeIcon: "",
        },
      });
      const insights = ref({ kda: "", csPerMin: "", kpPerMin: "" });
      const ddVersion = ref("");
      let champIndex: Record<string, string> = {};
      let runeIndex: Record<number, string> = {};
      const teams = ref({
        my: [] as Array<any>,
        enemy: [] as Array<any>,
      });
      const eventLog = ref(
        [] as Array<{ icon: string; time: string; text: string }>
      );
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
      const notifications = ref(
        [] as Array<{
          id: string;
          title: string;
          body?: string;
          icon?: string;
          severity: "info" | "warning" | "critical";
          at: number;
        }>
      );

      function fmtClock(seconds: number): string {
        const s = Math.floor(seconds);
        const m = Math.floor(s / 60);
        const sec = (s % 60).toString().padStart(2, "0");
        return `${m}:${sec}`;
      }

      async function ensureVersion(): Promise<string> {
        if (ddVersion.value) return ddVersion.value;
        const res = await fetch(
          "https://ddragon.leagueoflegends.com/api/versions.json"
        );
        const arr = await res.json();
        ddVersion.value = arr[0];
        return ddVersion.value;
      }

      async function ensureChampionIndex(): Promise<Record<string, string>> {
        if (Object.keys(champIndex).length) return champIndex;
        const version = await ensureVersion();
        const res = await fetch(
          `https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/champion.json`
        );
        const json = await res.json();
        const map: Record<string, string> = {};
        for (const key of Object.keys(json.data)) {
          const c = json.data[key];
          map[c.name] = c.id;
        }
        champIndex = map;
        return champIndex;
      }

      function buildChampionSquareUrl(
        version: string,
        championId: string
      ): string {
        return `https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${championId}.png`;
      }
      function buildItemIconUrl(version: string, itemId: number): string {
        return `https://ddragon.leagueoflegends.com/cdn/${version}/img/item/${itemId}.png`;
      }
      function buildSpellIconUrl(version: string, key: string): string {
        return `https://ddragon.leagueoflegends.com/cdn/${version}/img/spell/${key}.png`;
      }
      function buildRuneIconUrl(iconPath: string): string {
        return `https://ddragon.leagueoflegends.com/cdn/img/${iconPath}`;
      }
      async function ensureRunesIndex(): Promise<Record<number, string>> {
        if (Object.keys(runeIndex).length) return runeIndex;
        const version = await ensureVersion();
        const res = await fetch(
          `https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/runesReforged.json`
        );
        const trees = await res.json();
        const map: Record<number, string> = {};
        for (const tree of trees) {
          map[tree.id] = tree.icon;
          for (const slot of tree.slots) {
            for (const r of slot.runes) {
              map[r.id] = r.icon;
            }
          }
        }
        runeIndex = map;
        return runeIndex;
      }
      function mapSpellDisplayNameToKey(name: string): string | null {
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
          Clarity: "SummonerMana",
          Mark: "SummonerSnowball",
        };
        if (map[name]) return map[name];
        const n = (name || "").toLowerCase();
        if (n.includes("teleport")) return "SummonerTeleport";
        return null;
      }

      async function refresh() {
        try {
          errorMsg.value = "";
          const dump = await (window as any).api.getRawDump();
          meta.value = dump?.meta || {};
          endpoints.value = dump?.endpoints || {};
          await buildSummary();
          await buildTeams();
          buildEventLog();
        } catch (e: any) {
          errorMsg.value = e?.message || String(e);
        }
      }

      async function buildSummary() {
        try {
          const gs =
            endpoints.value?.gamestats?.data ||
            endpoints.value?.allgamedata?.data?.gameData;
          const ap =
            endpoints.value?.activeplayer?.data ||
            endpoints.value?.allgamedata?.data?.activePlayer;
          const scores = endpoints.value?.playerscores?.data;
          const items = endpoints.value?.playeritems?.data as any[] | undefined;
          const spells = endpoints.value?.playersummonerspells?.data;

          summary.value.game.mode = gs?.gameMode || "";
          const sec =
            typeof gs?.gameTime === "number" ? Math.floor(gs.gameTime) : null;
          summary.value.game.time =
            sec !== null
              ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`
              : "";
          summary.value.game.map = gs?.mapName || "";

          summary.value.me.riotId = ap?.riotId || ap?.summonerName || "";
          const myPlayer =
            (endpoints.value?.allgamedata?.data?.allPlayers || []).find(
              (p: any) =>
                (p.riotId || p.summonerName) === summary.value.me.riotId
            ) || null;
          summary.value.me.champion = myPlayer?.championName || "";
          summary.value.me.level = ap?.level ?? null;

          summary.value.scores.kills = scores?.kills ?? null;
          summary.value.scores.deaths = scores?.deaths ?? null;
          summary.value.scores.assists = scores?.assists ?? null;
          summary.value.scores.cs = scores?.creepScore ?? null;
          summary.value.scores.vision = scores?.wardScore ?? null;

          // Icons
          const version = await ensureVersion();
          const cIndex = await ensureChampionIndex();
          const champId =
            cIndex[summary.value.me.champion] ||
            (summary.value.me.champion
              ? summary.value.me.champion.replace(/\s|[^A-Za-z]/g, "")
              : "");
          summary.value.me.championIcon = champId
            ? buildChampionSquareUrl(version, champId)
            : "";

          summary.value.items = (items || []).map((i: any) => ({
            id: i.itemID,
            name: i.displayName,
            icon: buildItemIconUrl(version, i.itemID),
            tooltip: `${i.displayName} • Slot ${i.slot} • Count ${i.count} • Price ${i.price}`,
          }));
          summary.value.spells.d = spells?.summonerSpellOne?.displayName || "";
          summary.value.spells.f = spells?.summonerSpellTwo?.displayName || "";
          const keyD = mapSpellDisplayNameToKey(summary.value.spells.d);
          const keyF = mapSpellDisplayNameToKey(summary.value.spells.f);
          summary.value.spells.dIcon = keyD
            ? buildSpellIconUrl(version, keyD)
            : "";
          summary.value.spells.fIcon = keyF
            ? buildSpellIconUrl(version, keyF)
            : "";

          // Runes (playermainrunes)
          const pr = endpoints.value?.playermainrunes?.data;
          if (pr) {
            const rIndex = await ensureRunesIndex();
            const kIcon = pr.keystone?.id ? rIndex[pr.keystone.id] : "";
            const pIcon = pr.primaryRuneTree?.id
              ? rIndex[pr.primaryRuneTree.id]
              : "";
            const sIcon = pr.secondaryRuneTree?.id
              ? rIndex[pr.secondaryRuneTree.id]
              : "";
            summary.value.runes.keystoneName = pr.keystone?.displayName || "";
            summary.value.runes.primaryTreeName =
              pr.primaryRuneTree?.displayName || "";
            summary.value.runes.secondaryTreeName =
              pr.secondaryRuneTree?.displayName || "";
            summary.value.runes.keystoneIcon = kIcon
              ? buildRuneIconUrl(kIcon)
              : "";
            summary.value.runes.primaryTreeIcon = pIcon
              ? buildRuneIconUrl(pIcon)
              : "";
            summary.value.runes.secondaryTreeIcon = sIcon
              ? buildRuneIconUrl(sIcon)
              : "";
          } else {
            summary.value.runes = {
              keystoneName: "",
              keystoneIcon: "",
              primaryTreeName: "",
              primaryTreeIcon: "",
              secondaryTreeName: "",
              secondaryTreeIcon: "",
            } as any;
          }

          // Insights
          const minutes = sec ? Math.max(1 / 60, sec / 60) : 0;
          const k = summary.value.scores.kills || 0;
          const d = summary.value.scores.deaths || 0;
          const a = summary.value.scores.assists || 0;
          const cs = summary.value.scores.cs || 0;
          insights.value.kda =
            d === 0 ? `${k + a}/0` : `${((k + a) / d).toFixed(2)} KDA`;
          insights.value.csPerMin = minutes
            ? `${(cs / minutes).toFixed(2)} CS/Min`
            : "";
          insights.value.kpPerMin = minutes
            ? `${((k + a) / minutes).toFixed(2)} K+A/Min`
            : "";

          // Selected combat stats
          const st = ap?.championStats || {};
          summary.value.stats = {
            ad: st.attackDamage ?? null,
            ap: st.abilityPower ?? null,
            armor: st.armor ?? null,
            mr: st.magicResist ?? null,
            as: st.attackSpeed ?? null,
            haste: st.abilityHaste ?? null,
            ms: st.moveSpeed ?? null,
            hp: st.maxHealth ?? null,
            mp: st.resourceMax ?? null,
            tenacity: st.tenacity ?? null,
          };
        } catch {
          // ignore summary parse errors
        }
      }

      async function buildTeams() {
        try {
          const version = await ensureVersion();
          const players = (endpoints.value?.allgamedata?.data?.allPlayers ||
            []) as any[];
          if (!players.length) {
            teams.value.my = [];
            teams.value.enemy = [];
            return;
          }
          const meId = summary.value.me.riotId;
          const me =
            players.find((p) => (p.riotId || p.summonerName) === meId) ||
            players[0];
          const myTeam = me?.team || players[0].team;
          const cIndex = await ensureChampionIndex();
          function enrich(p: any) {
            const cName = p.championName || "";
            const cId =
              cIndex[cName] ||
              (cName ? cName.replace(/\s|[^A-Za-z]/g, "") : "");
            return {
              name: p.riotId || p.summonerName,
              team: p.team,
              champion: cName,
              championIcon: cId ? buildChampionSquareUrl(version, cId) : "",
              level: p.level,
              k: p.scores?.kills ?? 0,
              d: p.scores?.deaths ?? 0,
              a: p.scores?.assists ?? 0,
              cs: p.scores?.creepScore ?? 0,
              items: (p.items || []).map((i: any) => ({
                id: i.itemID,
                name: i.displayName,
                icon: buildItemIconUrl(version, i.itemID),
                tooltip: `${i.displayName} • Slot ${i.slot} • Count ${i.count} • Price ${i.price}`,
              })),
              spells: {
                d: p.summonerSpells?.summonerSpellOne?.displayName || "",
                f: p.summonerSpells?.summonerSpellTwo?.displayName || "",
                dIcon: mapSpellDisplayNameToKey(
                  p.summonerSpells?.summonerSpellOne?.displayName || ""
                )
                  ? buildSpellIconUrl(
                      version,
                      mapSpellDisplayNameToKey(
                        p.summonerSpells?.summonerSpellOne?.displayName || ""
                      ) as string
                    )
                  : "",
                fIcon: mapSpellDisplayNameToKey(
                  p.summonerSpells?.summonerSpellTwo?.displayName || ""
                )
                  ? buildSpellIconUrl(
                      version,
                      mapSpellDisplayNameToKey(
                        p.summonerSpells?.summonerSpellTwo?.displayName || ""
                      ) as string
                    )
                  : "",
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
        } catch {
          // ignore
        }
      }

      function buildEventLog() {
        try {
          const list = (endpoints.value?.eventdata?.data ||
            endpoints.value?.allgamedata?.data?.events?.Events ||
            []) as any[];
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
          eventLog.value = out;
        } catch {
          eventLog.value = [];
        }
      }

      function clearTimer() {
        if (timer) {
          clearInterval(timer);
          timer = null;
        }
      }

      function startTimer() {
        clearTimer();
        if (!auto.value) return;
        timer = setInterval(() => {
          void refresh();
          // prune expired toasts
          const now = Date.now();
          toasts.value = toasts.value.filter((t: { until: number }) => t.until > now);
        }, intervalMs.value);
      }

      async function applyInterval() {
        await (window as any).api.setPollingInterval(intervalMs.value);
        startTimer();
      }

      function pretty(v: any): string {
        try {
          return JSON.stringify(v, null, 2);
        } catch {
          return String(v);
        }
      }

      async function copy(v: any) {
        try {
          await navigator.clipboard.writeText(pretty(v));
        } catch {
          // ignore
        }
      }

      async function testTip() {
        try {
          await (window as any).api.emitTestTip({
            id: "test_tip",
            title: "Test Notification",
            body: "If you see this, notifications are wired up.",
            icon: "🔔",
            severity: "warning",
            stickyMs: 5000
          });
        } catch {
          // ignore
        }
      }

      onMounted(() => {
        // Load saved settings
        (window as any).api
          .getSettings()
          .then((s: any) => {
            intervalMs.value = s?.pollIntervalMs ?? 1000;
            startTimer();
          })
          .catch(() => {
            startTimer();
          });
        void refresh();
        // Tips subscription
        if ((window as any).api?.onTip) {
          (window as any).api.onTip((tip: any) => {
            const stickyMs =
              typeof tip?.stickyMs === "number" && tip.stickyMs > 0
                ? tip.stickyMs
                : 4000;
            const until = Date.now() + stickyMs;
            const idStr = String(tip?.id || Math.random());
            const sev =
              tip?.severity === "warning" || tip?.severity === "critical"
                ? tip.severity
                : "info";
            toasts.value.push({
              id: idStr,
              title: String(tip?.title || "Tip"),
              body: tip?.body ? String(tip.body) : undefined,
              icon: tip?.icon ? String(tip.icon) : undefined,
              severity: sev,
              until,
            });
            notifications.value.unshift({
              id: idStr + "-" + until,
              title: String(tip?.title || "Tip"),
              body: tip?.body ? String(tip.body) : undefined,
              icon: tip?.icon ? String(tip.icon) : undefined,
              severity: sev,
              at: Date.now(),
            });
            if (notifications.value.length > 100) notifications.value.length = 100;
          });
        }
      });

      // react to auto/interval changes
      (window as any).Vue.watch([auto, intervalMs], () => startTimer());

      return {
        meta,
        endpoints,
        errorMsg,
        auto,
        intervalMs,
        summary,
        insights,
        teams,
        eventLog,
        toasts,
        notifications,
        testTip,
        refresh,
        applyInterval,
        pretty,
        copy,
      };
    },
  }).mount("#app");
})();
