/**
 * GameState - CRDT-based shared game world (Pattern 3)
 *
 * Features:
 * - Conflict-free replicated data types
 * - Real-time synchronization across peers
 * - Player positions, inventories, shared content
 * - Automatic conflict resolution
 */

import { EventEmitter } from 'eventemitter3';
import { nanoid } from 'nanoid';
import { P2PNetwork } from './P2PNetwork.js';
import { GameContent, GameItem, GameCharacter } from './types/GameContent.js';

export interface PlayerState {
  id: string;
  name: string;
  position: { x: number; y: number };
  inventory: GameItem[];
  character?: GameCharacter;
  online: boolean;
  lastSeen: number;
}

export interface SharedContent {
  id: string;
  type: string;
  data: GameContent;
  owner: string;
  timestamp: number;
  version: number;
}

export interface GameStateConfig {
  playerId: string;
  maxPlayers?: number;
  syncInterval?: number; // ms
}

/**
 * Simple CRDT implementation using Last-Write-Wins (LWW)
 */
class LWWRegister<T> {
  private value: T;
  private timestamp: number;
  private nodeId: string;

  constructor(initialValue: T, nodeId: string) {
    this.value = initialValue;
    this.timestamp = Date.now();
    this.nodeId = nodeId;
  }

  set(value: T, timestamp?: number): void {
    const ts = timestamp || Date.now();
    if (ts > this.timestamp || (ts === this.timestamp && this.nodeId > this.nodeId)) {
      this.value = value;
      this.timestamp = ts;
    }
  }

  get(): T {
    return this.value;
  }

  getTimestamp(): number {
    return this.timestamp;
  }

  merge(other: LWWRegister<T>): void {
    if (
      other.getTimestamp() > this.timestamp ||
      (other.getTimestamp() === this.timestamp && other.nodeId > this.nodeId)
    ) {
      this.value = other.get();
      this.timestamp = other.getTimestamp();
    }
  }
}

/**
 * CRDT Set for shared content
 */
class CRDTSet<T extends { id: string }> {
  private items: Map<string, { item: T; timestamp: number; deleted: boolean }>;
  private nodeId: string;

  constructor(nodeId: string) {
    this.items = new Map();
    this.nodeId = nodeId;
  }

  add(item: T, timestamp?: number): void {
    const ts = timestamp || Date.now();
    const existing = this.items.get(item.id);

    if (!existing || ts > existing.timestamp) {
      this.items.set(item.id, { item, timestamp: ts, deleted: false });
    }
  }

  remove(id: string, timestamp?: number): void {
    const ts = timestamp || Date.now();
    const existing = this.items.get(id);

    if (!existing || ts > existing.timestamp) {
      if (existing) {
        this.items.set(id, { ...existing, timestamp: ts, deleted: true });
      }
    }
  }

  has(id: string): boolean {
    const item = this.items.get(id);
    return item !== undefined && !item.deleted;
  }

  get(id: string): T | undefined {
    const item = this.items.get(id);
    return item && !item.deleted ? item.item : undefined;
  }

  values(): T[] {
    return Array.from(this.items.values())
      .filter(item => !item.deleted)
      .map(item => item.item);
  }

  merge(other: CRDTSet<T>): void {
    for (const [id, otherItem] of (other as any).items) {
      const existing = this.items.get(id);

      if (!existing || otherItem.timestamp > existing.timestamp) {
        this.items.set(id, otherItem);
      }
    }
  }

  toJSON(): any {
    return {
      items: Array.from(this.items.entries()),
      nodeId: this.nodeId
    };
  }

  fromJSON(json: any): void {
    this.items = new Map(json.items);
    this.nodeId = json.nodeId;
  }
}

export class GameState extends EventEmitter {
  private config: GameStateConfig;
  private network: P2PNetwork;
  private players: Map<string, PlayerState>;
  private sharedContent: CRDTSet<SharedContent>;
  private localPlayer: PlayerState;
  private syncTimer?: NodeJS.Timeout;
  private version: number;

  constructor(network: P2PNetwork, config: GameStateConfig) {
    super();
    this.config = {
      maxPlayers: 100,
      syncInterval: 100, // 100ms for real-time feel
      ...config
    };

    this.network = network;
    this.players = new Map();
    this.sharedContent = new CRDTSet(config.playerId);
    this.version = 0;

    // Initialize local player
    this.localPlayer = {
      id: config.playerId,
      name: `Player_${config.playerId.substring(0, 6)}`,
      position: { x: 0, y: 0 },
      inventory: [],
      online: true,
      lastSeen: Date.now()
    };

    this.players.set(config.playerId, this.localPlayer);

    this.setupNetworkHandlers();
  }

  /**
   * Initialize game state and start syncing
   */
  async initialize(): Promise<void> {
    this.startSync();
    this.emit('initialized', { playerId: this.config.playerId });
  }

  /**
   * Update local player position
   */
  updatePlayerPosition(x: number, y: number): void {
    this.localPlayer.position = { x, y };
    this.localPlayer.lastSeen = Date.now();
    this.version++;

    this.emit('player-moved', {
      playerId: this.localPlayer.id,
      position: this.localPlayer.position
    });

    // Broadcast update
    this.broadcastState();
  }

  /**
   * Add item to local player inventory
   */
  addToInventory(item: GameItem): void {
    this.localPlayer.inventory.push(item);
    this.version++;

    this.emit('inventory-updated', {
      playerId: this.localPlayer.id,
      inventory: this.localPlayer.inventory
    });

    this.broadcastState();
  }

  /**
   * Remove item from local player inventory
   */
  removeFromInventory(itemId: string): void {
    const index = this.localPlayer.inventory.findIndex(i => i.id === itemId);
    if (index !== -1) {
      const removed = this.localPlayer.inventory.splice(index, 1)[0];
      this.version++;

      this.emit('inventory-updated', {
        playerId: this.localPlayer.id,
        inventory: this.localPlayer.inventory,
        removed
      });

      this.broadcastState();
    }
  }

  /**
   * Set local player character
   */
  setCharacter(character: GameCharacter): void {
    this.localPlayer.character = character;
    this.version++;

    this.emit('character-updated', {
      playerId: this.localPlayer.id,
      character
    });

    this.broadcastState();
  }

  /**
   * Share content with all players
   */
  shareContent(content: GameContent): void {
    const sharedContent: SharedContent = {
      id: nanoid(),
      type: 'content',
      data: content,
      owner: this.config.playerId,
      timestamp: Date.now(),
      version: this.version++
    };

    this.sharedContent.add(sharedContent);

    this.emit('content-shared', { content: sharedContent });

    this.broadcastState();
  }

  /**
   * Get all shared content
   */
  getSharedContent(): SharedContent[] {
    return this.sharedContent.values();
  }

  /**
   * Get all online players
   */
  getOnlinePlayers(): PlayerState[] {
    const now = Date.now();
    const timeout = 30000; // 30 seconds

    return Array.from(this.players.values()).filter(player => {
      return player.online && (now - player.lastSeen) < timeout;
    });
  }

  /**
   * Get player by ID
   */
  getPlayer(playerId: string): PlayerState | undefined {
    return this.players.get(playerId);
  }

  /**
   * Get local player state
   */
  getLocalPlayer(): PlayerState {
    return { ...this.localPlayer };
  }

  /**
   * Broadcast current state to all peers
   */
  private broadcastState(): void {
    const state = {
      player: this.localPlayer,
      sharedContent: this.sharedContent.toJSON(),
      version: this.version,
      timestamp: Date.now()
    };

    this.network.gossip({
      type: 'state-sync',
      state
    });
  }

  /**
   * Setup network message handlers
   */
  private setupNetworkHandlers(): void {
    this.network.on('gossip-received', ({ content, originPeer }) => {
      if (content.type === 'state-sync') {
        this.handleStateSync(content.state, originPeer);
      }
    });

    this.network.onMessage('state_sync', (message) => {
      this.handleStateSync(message.payload, message.from);
    });

    this.network.on('peer-disconnected', ({ peerId }) => {
      this.handlePlayerDisconnect(peerId);
    });
  }

  /**
   * Handle state synchronization from peer
   */
  private handleStateSync(state: any, peerId: string): void {
    // Update or add player
    if (state.player) {
      const existingPlayer = this.players.get(state.player.id);

      if (!existingPlayer || state.player.lastSeen > existingPlayer.lastSeen) {
        this.players.set(state.player.id, {
          ...state.player,
          online: true
        });

        this.emit('player-updated', {
          playerId: state.player.id,
          player: state.player
        });
      }
    }

    // Merge shared content using CRDT
    if (state.sharedContent) {
      const remoteCRDT = new CRDTSet<SharedContent>(peerId);
      remoteCRDT.fromJSON(state.sharedContent);
      this.sharedContent.merge(remoteCRDT);

      this.emit('content-synced', {
        contentCount: this.sharedContent.values().length
      });
    }
  }

  /**
   * Handle player disconnect
   */
  private handlePlayerDisconnect(peerId: string): void {
    const player = this.players.get(peerId);
    if (player) {
      player.online = false;
      this.emit('player-disconnected', { playerId: peerId });
    }
  }

  /**
   * Start periodic state synchronization
   */
  private startSync(): void {
    this.syncTimer = setInterval(() => {
      // Broadcast state periodically
      this.broadcastState();

      // Clean up offline players
      this.cleanupOfflinePlayers();
    }, this.config.syncInterval!);
  }

  /**
   * Stop synchronization
   */
  private stopSync(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = undefined;
    }
  }

  /**
   * Clean up players who haven't been seen recently
   */
  private cleanupOfflinePlayers(): void {
    const now = Date.now();
    const timeout = 60000; // 1 minute

    for (const [playerId, player] of this.players) {
      if (playerId !== this.config.playerId && (now - player.lastSeen) > timeout) {
        player.online = false;
      }
    }
  }

  /**
   * Get game state statistics
   */
  getStats(): {
    totalPlayers: number;
    onlinePlayers: number;
    sharedContent: number;
    version: number;
  } {
    return {
      totalPlayers: this.players.size,
      onlinePlayers: this.getOnlinePlayers().length,
      sharedContent: this.sharedContent.values().length,
      version: this.version
    };
  }

  /**
   * Export game state for persistence
   */
  exportState(): string {
    return JSON.stringify({
      localPlayer: this.localPlayer,
      players: Array.from(this.players.entries()),
      sharedContent: this.sharedContent.toJSON(),
      version: this.version
    });
  }

  /**
   * Import game state from persistence
   */
  importState(stateJson: string): void {
    const data = JSON.parse(stateJson);

    this.localPlayer = data.localPlayer;
    this.players = new Map(data.players);
    this.sharedContent.fromJSON(data.sharedContent);
    this.version = data.version;

    this.emit('state-imported', {
      players: this.players.size,
      content: this.sharedContent.values().length
    });
  }

  /**
   * Shutdown game state
   */
  async shutdown(): Promise<void> {
    this.stopSync();

    // Mark local player as offline
    this.localPlayer.online = false;
    this.broadcastState();

    this.players.clear();
    this.emit('shutdown');
  }
}
