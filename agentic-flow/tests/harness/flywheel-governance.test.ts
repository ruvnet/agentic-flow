import { describe, expect, it } from 'vitest';
import { generateKeyPairPem, sha256Hex } from '../../src/harness/provenance.js';
import {
  authorizePromotion,
  createBenchmarkAnchor,
  createEvaluationReceipt,
  evaluateCandidate,
  governanceHash,
  promoteCandidate,
  verifyGovernanceReplay,
  type PromotionProposal,
} from '../../src/harness/flywheel-governance.js';

const digest = (value: string) => sha256Hex(value);

function proposal(): PromotionProposal {
  const anchor = createBenchmarkAnchor({
    project: 'agentic-flow',
    corpusHash: digest('corpus'),
    embeddingSpaceHash: digest('embedding'),
    indexTopologyHash: digest('hnsw:m=16'),
    evaluatorHash: digest('evaluator-v1'),
  });
  const receipt = createEvaluationReceipt({
    experimentRevision: 'experiment-7',
    candidateCommit: 'abc123',
    candidateHash: digest('candidate'),
    baselineGeneration: 'generation-4',
    anchor,
    gateFingerprint: digest('gate-v1'),
    baseline: { primary: 0.7, noopRate: 0.1, costPerWin: 2 },
    candidate: { primary: 0.8, noopRate: 0.05, costPerWin: 1.8 },
    createdAt: '2026-07-29T12:00:00.000Z',
  });
  return { version: 1, receipt, receiptHash: governanceHash(receipt), promote: true, reasons: [] };
}

describe('Flywheel governance', () => {
  it('delegates the frozen conjunctive gate to Flywheel 0.1.7', async () => {
    const evaluated = await evaluateCandidate(proposal().receipt);
    expect(evaluated.promote).toBe(true);
    expect(evaluated.receiptHash).toBe(governanceHash(evaluated.receipt));
  });

  it('changes evidence identity when only embedding space changes', () => {
    const first = proposal();
    const changedAnchor = createBenchmarkAnchor({
      ...first.receipt.anchor,
      embeddingSpaceHash: digest('different-query-template'),
    });
    const changed = createEvaluationReceipt({ ...first.receipt, anchor: changedAnchor });
    expect(changed.anchorHash).not.toBe(first.receipt.anchorHash);
    expect(governanceHash(changed)).not.toBe(first.receiptHash);
  });

  it('requires trusted scoped authorization and an atomic baseline CAS', async () => {
    const p = proposal();
    const keys = generateKeyPairPem();
    const auth = authorizePromotion(
      p, 'release-bot', '2026-07-30T12:00:00.000Z', keys.privateKey, keys.publicKey,
    );
    let calls = 0;
    const record = await promoteCandidate(p, auth, {
      compareAndSwap: async (baseline, candidate, evidence) => {
        calls++;
        expect([baseline, candidate, evidence]).toEqual([
          'generation-4', p.receipt.candidateHash, p.receiptHash,
        ]);
        return { promoted: true, generation: 'generation-5' };
      },
    }, {
      now: new Date('2026-07-29T13:00:00.000Z'),
      trustedPublicKeys: new Set([keys.publicKey]),
    });
    expect(calls).toBe(1);
    expect(record.generation).toBe('generation-5');
    expect(verifyGovernanceReplay(
      { proposal: p, authorization: auth, promotion: record },
      { now: new Date('2026-07-29T13:00:00.000Z'), trustedPublicKeys: new Set([keys.publicKey]) },
    ).valid).toBe(true);
  });

  it('rejects expiration, tampering, and a stale baseline', async () => {
    const p = proposal();
    const keys = generateKeyPairPem();
    const auth = authorizePromotion(
      p, 'release-bot', '2026-07-30T12:00:00.000Z', keys.privateKey, keys.publicKey,
    );
    const expired = promoteCandidate(p, auth, {
      compareAndSwap: async () => ({ promoted: true, generation: 'bad' }),
    }, { now: new Date('2026-08-01T00:00:00.000Z'), trustedPublicKeys: new Set([keys.publicKey]) });
    await expect(expired).rejects.toThrow('invalid promotion authorization');
    await expect(promoteCandidate(p, { ...auth, expiresAt: 'never' }, {
      compareAndSwap: async () => ({ promoted: true, generation: 'bad' }),
    }, {
      now: new Date('2026-07-29T13:00:00.000Z'),
      trustedPublicKeys: new Set([keys.publicKey]),
    })).rejects.toThrow('invalid promotion authorization');

    const tampered = { ...p, receipt: { ...p.receipt, candidateCommit: 'other' } };
    await expect(promoteCandidate(tampered, auth, {
      compareAndSwap: async () => ({ promoted: true, generation: 'bad' }),
    }, {
      now: new Date('2026-07-29T13:00:00.000Z'),
      trustedPublicKeys: new Set([keys.publicKey]),
    })).rejects.toThrow();

    await expect(promoteCandidate(p, auth, {
      compareAndSwap: async () => ({ promoted: false, generation: 'generation-6' }),
    }, {
      now: new Date('2026-07-29T13:00:00.000Z'),
      trustedPublicKeys: new Set([keys.publicKey]),
    })).rejects.toThrow('promotion race');
  });
});
