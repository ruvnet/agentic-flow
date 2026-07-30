/**
 * Trusted evaluation/promotion boundary (ADR-077).
 * Candidate jobs create evidence; only a trusted signer plus an atomic CAS can promote.
 */
import { createHash, sign as cryptoSign, verify as cryptoVerify } from 'node:crypto';
import { evaluateMetaHarnessPromotion } from './metaharness.js';

export interface BenchmarkAnchor {
  version: 1;
  project: string;
  corpusHash: string;
  embeddingSpaceHash: string;
  indexTopologyHash: string;
  evaluatorHash: string;
}
export interface PromotionMetrics {
  primary: number;
  noopRate: number;
  costPerWin: number;
  regressed?: boolean;
}
export interface EvaluationReceipt {
  version: 1;
  experimentRevision: string;
  candidateCommit: string;
  candidateHash: string;
  baselineGeneration: string;
  anchor: BenchmarkAnchor;
  anchorHash: string;
  gateFingerprint: string;
  baseline: PromotionMetrics;
  candidate: PromotionMetrics;
  anchorMetric?: { baseline: number; candidate: number };
  createdAt: string;
}
export interface PromotionProposal {
  version: 1;
  receipt: EvaluationReceipt;
  receiptHash: string;
  promote: boolean;
  reasons: string[];
}
export interface PromotionAuthorization {
  version: 1;
  receiptHash: string;
  candidateCommit: string;
  expiresAt: string;
  signer: string;
  signature: string;
  publicKey: string;
}
export interface AtomicPromotionStore {
  compareAndSwap(expectedGeneration: string, candidateHash: string, evidenceHash: string):
    Promise<{ promoted: boolean; generation: string }>;
}
export interface PromotionRecord {
  version: 1;
  receiptHash: string;
  candidateCommit: string;
  candidateHash: string;
  previousGeneration: string;
  generation: string;
  signer: string;
  promotedAt: string;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
export function governanceHash(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}
function assertDigest(name: string, digest: string): void {
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new TypeError(`${name} must be a lowercase sha256 digest`);
}
export function createBenchmarkAnchor(input: Omit<BenchmarkAnchor, 'version'>): BenchmarkAnchor {
  for (const field of ['corpusHash', 'embeddingSpaceHash', 'indexTopologyHash', 'evaluatorHash'] as const) {
    assertDigest(field, input[field]);
  }
  if (!input.project.trim()) throw new TypeError('project is required');
  return { version: 1, ...input };
}
export function createEvaluationReceipt(input: Omit<EvaluationReceipt, 'version' | 'anchorHash'>): EvaluationReceipt {
  assertDigest('candidateHash', input.candidateHash);
  assertDigest('gateFingerprint', input.gateFingerprint);
  if (!input.experimentRevision.trim() || !input.candidateCommit.trim() || !input.baselineGeneration.trim()) {
    throw new TypeError('experimentRevision, candidateCommit, and baselineGeneration are required');
  }
  if (!Number.isFinite(Date.parse(input.createdAt))) throw new TypeError('createdAt must be an ISO timestamp');
  return { version: 1, ...input, anchorHash: governanceHash(input.anchor) };
}
export async function evaluateCandidate(receipt: EvaluationReceipt): Promise<PromotionProposal> {
  if (receipt.anchorHash !== governanceHash(receipt.anchor)) throw new Error('benchmark anchor hash mismatch');
  const decision = await evaluateMetaHarnessPromotion({
    baseline: receipt.baseline,
    candidate: receipt.candidate,
    ...(receipt.anchorMetric ? { anchor: receipt.anchorMetric } : {}),
  });
  return {
    version: 1,
    receipt,
    receiptHash: governanceHash(receipt),
    promote: decision.promote,
    reasons: [...decision.reasons],
  };
}
function authorizationPayload(auth: Omit<PromotionAuthorization, 'signature' | 'publicKey'>): string {
  return canonical(auth);
}
export function authorizePromotion(
  proposal: PromotionProposal,
  signer: string,
  expiresAt: string,
  privateKey: string,
  publicKey: string,
): PromotionAuthorization {
  if (!proposal.promote) throw new Error('cannot authorize a rejected or inconclusive proposal');
  const unsigned = {
    version: 1 as const,
    receiptHash: proposal.receiptHash,
    candidateCommit: proposal.receipt.candidateCommit,
    expiresAt,
    signer,
  };
  const signature = cryptoSign(null, Buffer.from(authorizationPayload(unsigned)), privateKey).toString('base64');
  return { ...unsigned, signature, publicKey };
}
export function verifyPromotionAuthorization(
  proposal: PromotionProposal,
  authorization: PromotionAuthorization,
  now = new Date(),
): boolean {
  const expiry = Date.parse(authorization.expiresAt);
  if (!proposal.promote || authorization.receiptHash !== proposal.receiptHash ||
      authorization.candidateCommit !== proposal.receipt.candidateCommit ||
      !Number.isFinite(expiry) || expiry <= now.getTime()) return false;
  const { signature, publicKey, ...unsigned } = authorization;
  try {
    return cryptoVerify(null, Buffer.from(authorizationPayload(unsigned)), publicKey, Buffer.from(signature, 'base64'));
  } catch {
    return false;
  }
}
export async function promoteCandidate(
  proposal: PromotionProposal,
  authorization: PromotionAuthorization,
  store: AtomicPromotionStore,
  options: { now?: Date; trustedPublicKeys: ReadonlySet<string> },
): Promise<PromotionRecord> {
  const now = options.now ?? new Date();
  if (!options.trustedPublicKeys.has(authorization.publicKey)) throw new Error('untrusted promotion signer');
  if (!verifyPromotionAuthorization(proposal, authorization, now)) throw new Error('invalid promotion authorization');
  if (proposal.receiptHash !== governanceHash(proposal.receipt)) throw new Error('evaluation receipt hash mismatch');
  const result = await store.compareAndSwap(
    proposal.receipt.baselineGeneration,
    proposal.receipt.candidateHash,
    proposal.receiptHash,
  );
  if (!result.promoted) throw new Error('promotion race: baseline generation changed');
  return {
    version: 1,
    receiptHash: proposal.receiptHash,
    candidateCommit: proposal.receipt.candidateCommit,
    candidateHash: proposal.receipt.candidateHash,
    previousGeneration: proposal.receipt.baselineGeneration,
    generation: result.generation,
    signer: authorization.signer,
    promotedAt: now.toISOString(),
  };
}
export function verifyGovernanceReplay(
  bundle: { proposal: PromotionProposal; authorization: PromotionAuthorization; promotion?: PromotionRecord },
  options: { now?: Date; trustedPublicKeys: ReadonlySet<string> },
): { valid: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (bundle.proposal.receiptHash !== governanceHash(bundle.proposal.receipt)) reasons.push('receipt hash mismatch');
  if (!options.trustedPublicKeys.has(bundle.authorization.publicKey)) reasons.push('untrusted signer');
  if (!verifyPromotionAuthorization(bundle.proposal, bundle.authorization, options.now)) reasons.push('invalid authorization');
  if (bundle.promotion && (bundle.promotion.receiptHash !== bundle.proposal.receiptHash ||
      bundle.promotion.candidateHash !== bundle.proposal.receipt.candidateHash)) {
    reasons.push('promotion lineage mismatch');
  }
  return { valid: reasons.length === 0, reasons };
}
