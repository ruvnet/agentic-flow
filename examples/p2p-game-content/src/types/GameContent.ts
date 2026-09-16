/**
 * Core type definitions for game content
 */

export interface GameCharacter {
  id: string;
  name: string;
  class: CharacterClass;
  level: number;
  stats: CharacterStats;
  appearance: string;
  createdBy: string; // peer ID
  timestamp: number;
  rating?: number;
}

export type CharacterClass = 'warrior' | 'mage' | 'rogue' | 'cleric' | 'ranger' | 'paladin';

export interface CharacterStats {
  hp: number;
  mp?: number;
  atk: number;
  def: number;
  spd: number;
  int?: number;
  lck?: number;
}

export interface GameQuest {
  id: string;
  title: string;
  description: string;
  objectives: string[];
  rewards: QuestRewards;
  difficulty: 'easy' | 'medium' | 'hard' | 'legendary';
  createdBy: string;
  timestamp: number;
  rating?: number;
}

export interface QuestRewards {
  gold: number;
  experience: number;
  items?: string[];
}

export interface GameItem {
  id: string;
  name: string;
  type: ItemType;
  rarity: ItemRarity;
  stats?: Partial<CharacterStats>;
  effects?: string[];
  description: string;
  createdBy: string;
  timestamp: number;
  rating?: number;
}

export type ItemType = 'weapon' | 'armor' | 'accessory' | 'consumable' | 'material' | 'key';
export type ItemRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythic';

export interface GameMap {
  id: string;
  name: string;
  dimensions: { width: number; height: number };
  tiles: MapTile[][];
  spawns: SpawnPoint[];
  createdBy: string;
  timestamp: number;
  rating?: number;
}

export interface MapTile {
  type: 'grass' | 'water' | 'mountain' | 'forest' | 'desert' | 'dungeon';
  walkable: boolean;
}

export interface SpawnPoint {
  x: number;
  y: number;
  entityType: 'player' | 'enemy' | 'npc' | 'treasure';
}

export interface GameDialog {
  id: string;
  npcName: string;
  lines: DialogLine[];
  createdBy: string;
  timestamp: number;
  rating?: number;
}

export interface DialogLine {
  text: string;
  choices?: DialogChoice[];
}

export interface DialogChoice {
  text: string;
  nextLineIndex: number;
  condition?: string;
}

export type GameContent = GameCharacter | GameQuest | GameItem | GameMap | GameDialog;
export type ContentType = 'character' | 'quest' | 'item' | 'map' | 'dialog';

export interface ContentGenerationRequest {
  type: ContentType;
  params?: Record<string, any>;
  playerPreferences?: PlayerPreferences;
}

export interface PlayerPreferences {
  favoriteClasses?: CharacterClass[];
  preferredDifficulty?: string;
  artStyle?: string;
  contentTags?: string[];
}

export interface ContentRating {
  contentId: string;
  rating: number; // 0-5
  playerId: string;
  timestamp: number;
}

export interface ContentValidation {
  contentId: string;
  isValid: boolean;
  votes: ValidationVote[];
  consensus: boolean;
  timestamp: number;
}

export interface ValidationVote {
  peerId: string;
  approved: boolean;
  reason?: string;
  timestamp: number;
}
