import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applySparkDecision,
  bothHaveMatchSlot,
  buildWhyMatched,
  canAcceptNewMatch,
  cosineSimilarity,
  isSparkExpired,
  resolveSparkAfterMutualAccept,
  remainingSlots,
  scoreMatchCandidate,
} from './match-rules';

describe('match cap', () => {
  it('allows matches under the cap', () => {
    assert.equal(canAcceptNewMatch(2), true);
    assert.equal(canAcceptNewMatch(3), false);
    assert.equal(remainingSlots(1), 2);
  });

  it('requires both users to have a slot', () => {
    assert.equal(
      bothHaveMatchSlot({ id: 'a', activeMatchCount: 2 }, { id: 'b', activeMatchCount: 3 }),
      false,
    );
    assert.equal(
      bothHaveMatchSlot({ id: 'a', activeMatchCount: 1 }, { id: 'b', activeMatchCount: 2 }),
      true,
    );
  });
});

describe('spark decisions', () => {
  const base = {
    userAId: 'a',
    userBId: 'b',
    createdAt: new Date(),
    status: 'pending' as const,
  };

  it('tracks partial and mutual accept', () => {
    const afterA = applySparkDecision(base, 'a', true);
    assert.equal(afterA.status, 'accepted_a');
    const afterBoth = applySparkDecision(afterA, 'b', true);
    assert.equal(afterBoth.status, 'matched');
  });

  it('declines on reject', () => {
    const declined = applySparkDecision(base, 'b', false);
    assert.equal(declined.status, 'declined');
  });

  it('holds match when slot is full', () => {
    const matched = { ...base, status: 'matched' as const, acceptedByA: true, acceptedByB: true };
    const result = resolveSparkAfterMutualAccept(
      matched,
      { id: 'a', activeMatchCount: 3 },
      { id: 'b', activeMatchCount: 1 },
    );
    assert.equal(result.createMatch, false);
    assert.equal(result.spark.status, 'held_for_slot');
  });
});

describe('expiry and scoring', () => {
  it('expires sparks after the accept window', () => {
    const createdAt = new Date(Date.now() - 25 * 60 * 60 * 1000);
    assert.equal(isSparkExpired(createdAt), true);
  });

  it('scores candidates with weighted features', () => {
    const score = scoreMatchCandidate({
      embeddingSimilarity: 1,
      mutualLikePrior: 1,
      activityRecencyScore: 1,
    });
    assert.equal(score, 1);
  });

  it('computes cosine similarity', () => {
    assert.ok(cosineSimilarity([1, 0], [1, 0]) > 0.99);
    assert.ok(cosineSimilarity([1, 0], [0, 1]) < 0.01);
  });

  it('builds why-matched bullets', () => {
    const why = buildWhyMatched({ interests: ['hiking', 'coffee'], city: 'Bangalore' });
    assert.ok(why.some((w) => w.includes('hiking')));
    assert.ok(why.some((w) => w.includes('Bangalore')));
  });
});
