// Types inferred from /data/examples payloads

export interface GameStats {
  gameMode: string;
  gameTime: number;
  mapName: string;
  mapNumber: number;
  mapTerrain: string;
}

export interface EventBase {
  EventID: number;
  EventName: string;
  EventTime: number;
  [key: string]: unknown;
}

export interface AbilityInfo {
  abilityLevel?: number;
  displayName: string;
  id: string;
  rawDescription: string;
  rawDisplayName: string;
}

export interface ActivePlayerAbilities {
  Q?: AbilityInfo;
  W?: AbilityInfo;
  E?: AbilityInfo;
  R?: AbilityInfo;
  Passive?: Omit<AbilityInfo, 'abilityLevel'>;
}

export interface ChampionStats {
  abilityHaste: number;
  abilityPower: number;
  armor: number;
  armorPenetrationFlat: number;
  armorPenetrationPercent: number;
  attackDamage: number;
  attackRange: number;
  attackSpeed: number;
  bonusArmorPenetrationPercent: number;
  bonusMagicPenetrationPercent: number;
  critChance: number;
  critDamage: number;
  currentHealth: number;
  healShieldPower: number;
  healthRegenRate: number;
  lifeSteal: number;
  magicLethality: number;
  magicPenetrationFlat: number;
  magicPenetrationPercent: number;
  magicResist: number;
  maxHealth: number;
  moveSpeed: number;
  omnivamp: number;
  physicalLethality: number;
  physicalVamp: number;
  resourceMax: number;
  resourceRegenRate: number;
  resourceType: string;
  resourceValue: number;
  spellVamp: number;
  tenacity: number;
}

export interface ActivePlayer {
  abilities: ActivePlayerAbilities;
  championStats: ChampionStats;
  currentGold: number;
  fullRunes: Record<string, unknown>;
  level: number;
  riotId?: string;
  riotIdGameName?: string;
  riotIdTagLine?: string;
  summonerName: string;
  teamRelativeColors: boolean;
}

export interface PlayerItem {
  canUse: boolean;
  consumable: boolean;
  count: number;
  displayName: string;
  itemID: number;
  price: number;
  rawDescription: string;
  rawDisplayName: string;
  slot: number;
}

export interface PlayerScores {
  assists: number;
  creepScore: number;
  deaths: number;
  kills: number;
  wardScore: number;
}

export interface SummonerSpellInfo {
  displayName: string;
  rawDescription: string;
  rawDisplayName: string;
}

export interface PlayerSummonerSpells {
  summonerSpellOne: SummonerSpellInfo;
  summonerSpellTwo: SummonerSpellInfo;
}

export interface PlayerListEntry {
  championName: string;
  isBot: boolean;
  isDead: boolean;
  items: PlayerItem[];
  level: number;
  position: string;
  rawChampionName: string;
  rawSkinName: string;
  respawnTimer: number;
  riotId?: string;
  riotIdGameName?: string;
  riotIdTagLine?: string;
  runes: unknown | null;
  scores: PlayerScores;
  skinID: number;
  skinName: string;
  summonerName: string;
  summonerSpells: PlayerSummonerSpells;
  team: 'ORDER' | 'CHAOS' | string;
}

export interface AllGameData {
  activePlayer: ActivePlayer;
  allPlayers: PlayerListEntry[];
  events: { Events: EventBase[] };
  gameData: GameStats;
}

// Endpoint envelope types used by the raw viewer
export interface EndpointEnvelope<T> {
  url?: string;
  usedUrl?: string | null;
  attempted?: string[];
  data: T;
}


