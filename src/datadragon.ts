import * as https from "https";

const CDN_BASE = "https://ddragon.leagueoflegends.com";

let cachedVersion: string | null = null;
let lastVersionFetchAt = 0;
let championNameToId: Map<string, string> | null = null;
let runeIdToIcon: Map<number, string> | null = null;

function getJson<T>(url: string): Promise<T> {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        // Check for redirects or errors
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          // Follow redirect
          return getJson<T>(res.headers.location).then(resolve).catch(reject);
        }
        if (res.statusCode && res.statusCode >= 400) {
          return reject(new Error(`HTTP ${res.statusCode} from ${url}`));
        }
        // Check content type
        const contentType = res.headers["content-type"] || "";
        if (
          !contentType.includes("application/json") &&
          !contentType.includes("text/json")
        ) {
          // If it's not JSON, it might be an error page
          let data = "";
          res.on("data", (chunk) => {
            data += chunk;
          });
          res.on("end", () => {
            if (
              data.trim().startsWith("<?xml") ||
              data.trim().startsWith("<html")
            ) {
              reject(
                new Error(
                  `Received non-JSON response (${contentType}) from ${url}`
                )
              );
            } else {
              // Try to parse anyway
              try {
                resolve(JSON.parse(data) as T);
              } catch (e) {
                reject(
                  new Error(
                    `Failed to parse JSON from ${url}: ${(e as Error).message}`
                  )
                );
              }
            }
          });
          return;
        }
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          try {
            resolve(JSON.parse(data) as T);
          } catch (e) {
            reject(
              new Error(
                `Failed to parse JSON from ${url}: ${
                  (e as Error).message
                }. Response: ${data.substring(0, 200)}`
              )
            );
          }
        });
      })
      .on("error", reject);
  });
}

export async function getLatestVersion(): Promise<string> {
  const now = Date.now();
  if (cachedVersion && now - lastVersionFetchAt < 60 * 60 * 1000)
    return cachedVersion;
  const versions = await getJson<string[]>(`${CDN_BASE}/api/versions.json`);
  cachedVersion = versions[0];
  lastVersionFetchAt = now;
  return cachedVersion!;
}

export async function ensureChampionIndex(
  lang = "en_US"
): Promise<Map<string, string>> {
  if (championNameToId) return championNameToId;
  const version = await getLatestVersion();
  type ChampIndex = { data: Record<string, { id: string; name: string }> };
  const json = await getJson<ChampIndex>(
    `${CDN_BASE}/cdn/${version}/data/${lang}/champion.json`
  );
  const map = new Map<string, string>();
  for (const key of Object.keys(json.data)) {
    const c = json.data[key];
    map.set(c.name, c.id);
  }
  championNameToId = map;
  return championNameToId;
}

export async function ensureRunesIndex(
  lang = "en_US"
): Promise<Map<number, string>> {
  if (runeIdToIcon) return runeIdToIcon;
  try {
    type RuneTree = {
      id: number;
      icon: string;
      slots: Array<{ runes: Array<{ id: number; icon: string }> }>;
    };
    // Use versioned path for better reliability
    const version = await getLatestVersion();
    const runes = await getJson<RuneTree[]>(
      `${CDN_BASE}/cdn/${version}/data/${lang}/runesReforged.json`
    );
    const map = new Map<number, string>();
    for (const tree of runes) {
      map.set(tree.id, tree.icon);
      for (const slot of tree.slots) {
        for (const r of slot.runes) {
          map.set(r.id, r.icon);
        }
      }
    }
    runeIdToIcon = map;
    return runeIdToIcon;
  } catch (e) {
    console.error(`[datadragon] Failed to build rune index:`, e);
    // Return empty map instead of throwing, so the app can continue
    runeIdToIcon = new Map<number, string>();
    return runeIdToIcon;
  }
}

export function buildChampionSquareUrl(
  version: string,
  championId: string
): string {
  return `${CDN_BASE}/cdn/${version}/img/champion/${championId}.png`;
}

export function buildItemIconUrl(version: string, itemId: number): string {
  return `${CDN_BASE}/cdn/${version}/img/item/${itemId}.png`;
}

export function buildRuneIconUrl(iconPath: string): string {
  // Rune icons live under /cdn/img/ with no version segment in the path
  return `${CDN_BASE}/cdn/img/${iconPath}`;
}
