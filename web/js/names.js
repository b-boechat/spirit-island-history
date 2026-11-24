// Turns the game's internal IDs (e.g. "BreathOfDarknessDownYourSpine") into
// display names ("Breath of Darkness Down Your Spine").
//
// Most names come out right from the generic camelCase split in humanize().
// The tables below only list names it gets wrong: apostrophes, hyphens,
// commas, or a nicer short form. Unknown IDs (new spirits, cards, ...) still
// get a readable name from humanize(), so nothing breaks when the game adds
// content. Add an entry here whenever a name looks off.

const MINOR_WORDS = new Set([
  "a", "an", "and", "as", "at", "but", "by", "for", "from", "in", "into",
  "nor", "of", "on", "onto", "or", "the", "to", "with",
]);

/** "SetThemOnAnEverTwistingTrail" -> "Set Them on an Ever Twisting Trail" */
export function humanize(id) {
  if (id == null || id === "") return "";
  const words = String(id)
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")          // fooBar  -> foo Bar
    .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2")     // APall   -> A Pall
    .replace(/([A-Za-z])(\d)/g, "$1 $2")          // Level3  -> Level 3
    .replace(/(\d)([A-Za-z])/g, "$1 $2")
    .trim()
    .split(/\s+/);
  return words
    // Small words are lowercase, except as the first or last word ("Closes In").
    .map((w, i) =>
      i > 0 && i < words.length - 1 && MINOR_WORDS.has(w.toLowerCase()) ? w.toLowerCase() : w)
    .join(" ");
}

// --- Override tables -------------------------------------------------------
// Some IDs below are for content not in your games yet; if the game uses a
// slightly different ID, the entry is simply unused and humanize() is used.

const SPIRITS = {
  LightningsSwiftStrike: "Lightning's Swift Strike",
  OceansHungryGrasp: "Ocean's Hungry Grasp",
  StonesUnyieldingDefiance: "Stone's Unyielding Defiance",
  EmberEyedBehemoth: "Ember-Eyed Behemoth",
  HearthVigil: "Hearth-Vigil",
  SunBrightWhirlwind: "Sun-Bright Whirlwind",
  ManyMindsMoveAsOne: "Many Minds Move as One",
  VengeanceAsABurningPlague: "Vengeance as a Burning Plague",
  StarlightSeeksItsForm: "Starlight Seeks Its Form",
  EyesWatchFromTheTrees: "Eyes Watch from the Trees",
};

// full: the official name; short: used in tables, filters and charts.
const ADVERSARIES = {
  TheKingdomOfBrandenburgPrussia: { full: "The Kingdom of Brandenburg-Prussia", short: "Brandenburg-Prussia" },
  TheKingdomOfEngland: { full: "The Kingdom of England", short: "England" },
  TheKingdomOfSweden: { full: "The Kingdom of Sweden", short: "Sweden" },
  TheKingdomOfFrance: { full: "The Kingdom of France (Plantation Colony)", short: "France" },
  TheHabsburgMonarchy: { full: "The Habsburg Monarchy (Livestock Colony)", short: "Habsburg Monarchy" },
  TheTsardomOfRussia: { full: "The Tsardom of Russia", short: "Russia" },
  TheKingdomOfScotland: { full: "The Kingdom of Scotland", short: "Scotland" },
  HabsburgMiningExpedition: { full: "Habsburg Mining Expedition", short: "Habsburg Mining" },
};

const POWER_CARDS = {
  FavorOfTheSunAndStarLitDark: "Favor of the Sun and Star-Lit Dark",
  FlowDownriverBlowDownwind: "Flow Downriver, Blow Downwind",
  FlowLikeWaterReachLikeAir: "Flow Like Water, Reach Like Air",
  FocusTheLandsAnguish: "Focus the Land's Anguish",
  GiftOfNaturesConnection: "Gift of Nature's Connection",
  GoldsAllure: "Gold's Allure",
  NaturesResilience: "Nature's Resilience",
  QuickenTheEarthsStruggles: "Quicken the Earth's Struggles",
  RazorSharpUndergrowth: "Razor-Sharp Undergrowth",
  RitesOfTheLandsRejection: "Rites of the Land's Rejection",
  SetThemOnAnEverTwistingTrail: "Set Them on an Ever-Twisting Trail",
  SpurOnWithWordsOfFire: "Spur On with Words of Fire",
  SunsetsFireFlowsAcrossTheLand: "Sunset's Fire Flows Across the Land",
  TurmoilsTouch: "Turmoil's Touch",
  UnleashATorrentOfTheSelfsOwnEssence: "Unleash a Torrent of the Self's Own Essence",
  VanishSoftlyAwayForgottenByAll: "Vanish Softly Away, Forgotten by All",
  VeilTheNightsHunt: "Veil the Night's Hunt",
};

const BLIGHT_CARDS = {
  NotFlipped: "Not flipped",
};

const ASPECTS = {};
const SCENARIOS = {};

const TABLES = {
  spirit: SPIRITS,
  aspect: ASPECTS,
  powerCard: POWER_CARDS,
  blightCard: BLIGHT_CARDS,
  scenario: SCENARIOS,
};

/** Display name for an ID of the given kind ("spirit", "aspect", "powerCard", ...). */
export function nameOf(kind, id) {
  if (id == null || id === "") return "";
  return TABLES[kind]?.[id] ?? humanize(id);
}

/** { full, short } names for an adversary ID. */
export function adversaryNames(id) {
  if (!id) return { full: "No adversary", short: "None" };
  if (ADVERSARIES[id]) return ADVERSARIES[id];
  const full = humanize(id);
  const short = humanize(id.replace(/^The(KingdomOf|TsardomOf|EmpireOf)?/, "")) || full;
  return { full, short };
}

// --- Game results ----------------------------------------------------------

const RESULT_REASONS = {
  WinTerrorVictory: "Terror Victory",
  LoseTooMuchBlight: "Too Much Blight",
  LoseAbandoned: "Abandoned",
  LoseSpiritDestroyed: "Spirit Destroyed",
  LoseInvaderDeckEmpty: "Time Ran Out",
  LoseTimeRanOut: "Time Ran Out",
};

/**
 * "WinInvadersDestroyedTerrorLevel3" ->
 *   { outcome: "win", reason: "Invaders Destroyed (Terror Level 3)", abandoned: false }
 */
export function resultInfo(id) {
  const raw = String(id ?? "");
  const match = raw.match(/^(Win|Victory|Lose|Loss|Defeat)(.*)$/i);
  const outcome = match
    ? (/^(win|victory)$/i.test(match[1]) ? "win" : "loss")
    : "unknown";
  let reason = RESULT_REASONS[raw];
  if (!reason) {
    const rest = match ? match[2] : raw;
    const level = rest.match(/^(.*?)TerrorLevel(\d)$/);
    reason = level
      ? `${humanize(level[1])} (Terror Level ${level[2]})`
      : humanize(rest) || (outcome === "win" ? "Victory" : outcome === "loss" ? "Defeat" : "Unknown");
  }
  return { outcome, reason, abandoned: /abandon/i.test(raw) };
}
