import EventEmitter from 'eventemitter3';
import { PeerInfo } from './types';

/**
 * Phi-accrual failure detector for adaptive failure detection
 * Based on "The φ Accrual Failure Detector" (Hayashibara et al., 2004)
 */
class PhiAccrualDetector {
  private intervals: number[] = [];
  private maxSamples: number = 1000;
  private lastHeartbeat: number = Date.now();

  recordHeartbeat(): void {
    const now = Date.now();
    const interval = now - this.lastHeartbeat;
    this.lastHeartbeat = now;

    this.intervals.push(interval);
    if (this.intervals.length > this.maxSamples) {
      this.intervals.shift();
    }
  }

  /**
   * Calculate phi value (suspicion level)
   * Higher phi = more likely to be failed
   * Typical threshold: 8-10
   */
  phi(): number {
    if (this.intervals.length === 0) {
      return 0;
    }

    const now = Date.now();
    const timeSinceLastHeartbeat = now - this.lastHeartbeat;

    // Calculate mean and variance
    const mean = this.intervals.reduce((a, b) => a + b, 0) / this.intervals.length;
    const variance =
      this.intervals.reduce((sum, interval) => sum + Math.pow(interval - mean, 2), 0) /
      this.intervals.length;
    const stddev = Math.sqrt(variance);

    // Phi calculation
    const probability = this.cdf(timeSinceLastHeartbeat, mean, stddev);
    const phi = -Math.log10(1 - probability);

    return phi;
  }

  /**
   * Cumulative distribution function for normal distribution
   */
  private cdf(x: number, mean: number, stddev: number): number {
    if (stddev === 0) {
      return x >= mean ? 1 : 0;
    }

    const z = (x - mean) / stddev;
    return 0.5 * (1 + this.erf(z / Math.sqrt(2)));
  }

  /**
   * Error function approximation
   */
  private erf(x: number): number {
    const sign = x >= 0 ? 1 : -1;
    x = Math.abs(x);

    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const p = 0.3275911;

    const t = 1.0 / (1.0 + p * x);
    const y = 1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

    return sign * y;
  }
}

/**
 * PeerManager - Manages peer list and failure detection
 *
 * Features:
 * - Phi-accrual failure detection (adaptive thresholds)
 * - Random peer selection for gossip
 * - Bootstrap protocol for joining
 * - Heartbeat monitoring
 */
export class PeerManager extends EventEmitter {
  private peers: Map<string, PeerInfo>;
  private failureDetectors: Map<string, PhiAccrualDetector>;
  private nodeId: string;
  private phiThreshold: number;
  private heartbeatInterval: number;
  private heartbeatTimer?: NodeJS.Timeout;

  constructor(
    nodeId: string,
    phiThreshold: number = 8,
    heartbeatInterval: number = 1000
  ) {
    super();
    this.nodeId = nodeId;
    this.peers = new Map();
    this.failureDetectors = new Map();
    this.phiThreshold = phiThreshold;
    this.heartbeatInterval = heartbeatInterval;
  }

  /**
   * Start heartbeat monitoring
   */
  start(): void {
    this.heartbeatTimer = setInterval(() => {
      this.checkFailures();
      this.emit('heartbeat', Array.from(this.peers.values()));
    }, this.heartbeatInterval);
  }

  /**
   * Stop heartbeat monitoring
   */
  stop(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  /**
   * Add or update a peer
   */
  addPeer(peer: Omit<PeerInfo, 'lastSeen' | 'failureCount' | 'isAlive'>): void {
    const existing = this.peers.get(peer.id);

    if (existing) {
      existing.address = peer.address;
      existing.port = peer.port;
      existing.lastSeen = Date.now();
      existing.isAlive = true;
    } else {
      this.peers.set(peer.id, {
        ...peer,
        lastSeen: Date.now(),
        failureCount: 0,
        isAlive: true,
      });

      this.failureDetectors.set(peer.id, new PhiAccrualDetector());
      this.emit('peer-added', peer);
    }
  }

  /**
   * Record heartbeat from a peer
   */
  recordHeartbeat(peerId: string): void {
    const peer = this.peers.get(peerId);
    const detector = this.failureDetectors.get(peerId);

    if (peer && detector) {
      peer.lastSeen = Date.now();
      peer.isAlive = true;
      peer.failureCount = 0;
      detector.recordHeartbeat();
    }
  }

  /**
   * Remove a peer
   */
  removePeer(peerId: string): void {
    const peer = this.peers.get(peerId);
    if (peer) {
      this.peers.delete(peerId);
      this.failureDetectors.delete(peerId);
      this.emit('peer-removed', peer);
    }
  }

  /**
   * Get a specific peer
   */
  getPeer(peerId: string): PeerInfo | undefined {
    return this.peers.get(peerId);
  }

  /**
   * Get all peers
   */
  getAllPeers(): PeerInfo[] {
    return Array.from(this.peers.values());
  }

  /**
   * Get all alive peers
   */
  getAlivePeers(): PeerInfo[] {
    return Array.from(this.peers.values()).filter((p) => p.isAlive);
  }

  /**
   * Get random peers for gossip (excluding self and failed peers)
   */
  getRandomPeers(count: number, exclude: string[] = []): PeerInfo[] {
    const excludeSet = new Set([...exclude, this.nodeId]);
    const candidates = Array.from(this.peers.values()).filter(
      (p) => p.isAlive && !excludeSet.has(p.id)
    );

    // Fisher-Yates shuffle
    const shuffled = [...candidates];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    return shuffled.slice(0, count);
  }

  /**
   * Check for failures using phi-accrual detector
   */
  private checkFailures(): void {
    for (const [peerId, detector] of this.failureDetectors.entries()) {
      const phi = detector.phi();
      const peer = this.peers.get(peerId);

      if (peer && phi > this.phiThreshold) {
        if (peer.isAlive) {
          peer.isAlive = false;
          peer.failureCount++;
          this.emit('peer-failed', peer, phi);
        }
      }
    }
  }

  /**
   * Bootstrap from a list of seed peers
   */
  async bootstrap(seeds: Array<{ address: string; port: number }>): Promise<void> {
    for (const seed of seeds) {
      this.addPeer({
        id: `${seed.address}:${seed.port}`,
        address: seed.address,
        port: seed.port,
      });
    }

    this.emit('bootstrap-complete', seeds.length);
  }

  /**
   * Get metrics
   */
  getMetrics(): {
    totalPeers: number;
    alivePeers: number;
    failedPeers: number;
    avgPhi: number;
  } {
    const peers = Array.from(this.peers.values());
    const alivePeers = peers.filter((p) => p.isAlive);
    const failedPeers = peers.filter((p) => !p.isAlive);

    const phiValues = Array.from(this.failureDetectors.values()).map((d) => d.phi());
    const avgPhi = phiValues.length > 0 ? phiValues.reduce((a, b) => a + b, 0) / phiValues.length : 0;

    return {
      totalPeers: peers.length,
      alivePeers: alivePeers.length,
      failedPeers: failedPeers.length,
      avgPhi,
    };
  }
}
