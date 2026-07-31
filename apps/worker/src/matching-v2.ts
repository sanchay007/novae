/**
 * Matching v2 — learning-to-rank feature sketch.
 * Phase 3 worker (`runMatchingV2Signals`) already harvests:
 * - match age in days
 * - message count
 *
 * Next model inputs (online + offline):
 * - reply_within_24h
 * - median_reply_latency
 * - date_intent_tap
 * - unmatch_reason one-hot
 * - mutual_like_prior from swipe graph
 *
 * Training loop (future):
 * 1. Export labeled pairs nightly
 * 2. Train two-tower or LambdaMART
 * 3. Publish weights to Redis
 * 4. Daily Spark job blends v1 cosine score with v2 LTR score
 */
export type MatchOutcomeFeatures = {
  matchId: string;
  ageDays: number;
  messageCount: number;
  replyWithin24h?: boolean;
  dateIntentTapped?: boolean;
  unmatchReason?: string;
};

export function ltrPriorScore(f: MatchOutcomeFeatures): number {
  let score = 0.4;
  if (f.messageCount > 0) score += 0.2;
  if (f.messageCount > 10) score += 0.15;
  if (f.replyWithin24h) score += 0.15;
  if (f.dateIntentTapped) score += 0.1;
  if (f.ageDays > 7 && f.messageCount === 0) score -= 0.2;
  return Math.max(0, Math.min(1, score));
}
