export const MAX_ACTIVE_MATCHES = 3;
export const FREE_DAILY_SPARKS = 1;
export const SPARK_ACCEPT_WINDOW_HOURS = 24;
export const MATCH_INACTIVE_EXPIRY_DAYS = 7;
export const MAX_PROFILE_PHOTOS = 6;
export const MAX_PROMPTS = 3;
export const FREE_AI_SUGGESTIONS_PER_DAY = 10;

export const GENDERS = ['woman', 'man', 'non_binary', 'other'] as const;
export const ORIENTATIONS = [
  'straight',
  'gay',
  'lesbian',
  'bisexual',
  'pansexual',
  'queer',
  'asexual',
  'other',
] as const;
export const RELATIONSHIP_INTENTS = [
  'long_term',
  'long_term_open',
  'short_term_open',
  'short_term',
  'figuring_out',
] as const;
export const DATE_IDEAS = [
  'coffee',
  'drinks',
  'walk',
  'dinner',
  'movie',
  'museum',
  'live_music',
  'picnic',
  'activity',
  'custom',
] as const;

export const MATCH_STATUSES = [
  'active',
  'expired',
  'unmatched',
  'blocked',
] as const;
export const SPARK_STATUSES = [
  'pending',
  'accepted_a',
  'accepted_b',
  'matched',
  'declined',
  'expired',
  'held_for_slot',
] as const;
export const SWIPE_ACTIONS = ['like', 'pass', 'super_spark'] as const;
export const REPORT_REASONS = [
  'spam',
  'harassment',
  'inappropriate_photos',
  'fake_profile',
  'underage',
  'other',
] as const;

export type Gender = (typeof GENDERS)[number];
export type Orientation = (typeof ORIENTATIONS)[number];
export type RelationshipIntent = (typeof RELATIONSHIP_INTENTS)[number];
export type DateIdea = (typeof DATE_IDEAS)[number];
export type MatchStatus = (typeof MATCH_STATUSES)[number];
export type SparkStatus = (typeof SPARK_STATUSES)[number];
export type SwipeAction = (typeof SWIPE_ACTIONS)[number];
export type ReportReason = (typeof REPORT_REASONS)[number];
