import { MAX_ACTIVE_MATCHES, SPARK_ACCEPT_WINDOW_HOURS } from './constants';

export type SlotUser = {
  id: string;
  activeMatchCount: number;
};

export type SparkPair = {
  userAId: string;
  userBId: string;
  createdAt: Date;
  status:
    | 'pending'
    | 'accepted_a'
    | 'accepted_b'
    | 'matched'
    | 'declined'
    | 'expired'
    | 'held_for_slot';
  acceptedByA?: boolean;
  acceptedByB?: boolean;
};

export function canAcceptNewMatch(
  activeMatchCount: number,
  maxActive: number = MAX_ACTIVE_MATCHES,
): boolean {
  return activeMatchCount < maxActive;
}

export function bothHaveMatchSlot(
  a: SlotUser,
  b: SlotUser,
  maxActive: number = MAX_ACTIVE_MATCHES,
): boolean {
  return canAcceptNewMatch(a.activeMatchCount, maxActive)
    && canAcceptNewMatch(b.activeMatchCount, maxActive);
}

export function applySparkDecision(
  spark: SparkPair,
  actorUserId: string,
  accept: boolean,
): SparkPair {
  if (spark.status === 'matched' || spark.status === 'declined' || spark.status === 'expired') {
    return spark;
  }

  if (!accept) {
    return { ...spark, status: 'declined' };
  }

  const isA = actorUserId === spark.userAId;
  const isB = actorUserId === spark.userBId;
  if (!isA && !isB) {
    throw new Error('Actor is not part of this spark');
  }

  const next: SparkPair = {
    ...spark,
    acceptedByA: isA ? true : spark.acceptedByA,
    acceptedByB: isB ? true : spark.acceptedByB,
  };

  if (next.acceptedByA && next.acceptedByB) {
    next.status = 'matched';
  } else if (next.acceptedByA) {
    next.status = 'accepted_a';
  } else if (next.acceptedByB) {
    next.status = 'accepted_b';
  }

  return next;
}

export function isSparkExpired(
  createdAt: Date,
  now: Date = new Date(),
  windowHours: number = SPARK_ACCEPT_WINDOW_HOURS,
): boolean {
  const ms = windowHours * 60 * 60 * 1000;
  return now.getTime() - createdAt.getTime() > ms;
}

export function resolveSparkAfterMutualAccept(
  spark: SparkPair,
  userA: SlotUser,
  userB: SlotUser,
  maxActive: number = MAX_ACTIVE_MATCHES,
): { spark: SparkPair; createMatch: boolean } {
  if (spark.status !== 'matched') {
    return { spark, createMatch: false };
  }

  if (!bothHaveMatchSlot(userA, userB, maxActive)) {
    return {
      spark: { ...spark, status: 'held_for_slot' },
      createMatch: false,
    };
  }

  return { spark, createMatch: true };
}

export function remainingSlots(
  activeMatchCount: number,
  maxActive: number = MAX_ACTIVE_MATCHES,
): number {
  return Math.max(0, maxActive - activeMatchCount);
}

/** Cosine similarity for two equal-length vectors. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function scoreMatchCandidate(input: {
  embeddingSimilarity: number;
  mutualLikePrior?: number;
  activityRecencyScore?: number;
}): number {
  const similarity = input.embeddingSimilarity;
  const mutual = input.mutualLikePrior ?? 0.5;
  const recency = input.activityRecencyScore ?? 0.5;
  return similarity * 0.55 + mutual * 0.25 + recency * 0.2;
}

export function buildWhyMatched(shared: {
  interests?: string[];
  intents?: string[];
  prompts?: string[];
  city?: string;
}): string[] {
  const why: string[] = [];
  if (shared.interests?.length) {
    why.push(`Shared interests: ${shared.interests.slice(0, 3).join(', ')}`);
  }
  if (shared.intents?.length) {
    why.push(`Similar dating goals`);
  }
  if (shared.prompts?.length) {
    why.push(`Compatible vibes on prompts`);
  }
  if (shared.city) {
    why.push(`Both in ${shared.city}`);
  }
  if (why.length === 0) {
    why.push('Your profiles suggest a strong first spark');
  }
  return why.slice(0, 4);
}
