/**
 * AssetRenderer - Render generated JSON as game sprites/UI
 *
 * Features:
 * - Render characters, items, maps as visual assets
 * - Multiple art styles support
 * - Procedural texture generation
 * - Canvas-based rendering
 */

import { EventEmitter } from 'eventemitter3';
import {
  GameCharacter,
  GameItem,
  GameMap,
  MapTile
} from './types/GameContent.js';

export interface AssetRendererConfig {
  canvasWidth?: number;
  canvasHeight?: number;
  tileSize?: number;
  artStyle?: 'pixel' | 'cartoon' | 'realistic';
}

export class AssetRenderer extends EventEmitter {
  private config: AssetRendererConfig;
  private canvas?: HTMLCanvasElement;
  private ctx?: CanvasRenderingContext2D;
  private spriteCache: Map<string, ImageData>;

  constructor(config: AssetRendererConfig = {}) {
    super();
    this.config = {
      canvasWidth: 800,
      canvasHeight: 600,
      tileSize: 32,
      artStyle: 'pixel',
      ...config
    };

    this.spriteCache = new Map();
  }

  /**
   * Initialize renderer with canvas
   */
  initialize(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    this.canvas.width = this.config.canvasWidth!;
    this.canvas.height = this.config.canvasHeight!;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get canvas context');
    }

    this.ctx = ctx;
    this.emit('initialized');
  }

  /**
   * Render a character sprite
   */
  renderCharacter(character: GameCharacter, x: number, y: number): void {
    if (!this.ctx) {
      throw new Error('Renderer not initialized');
    }

    const cacheKey = `character:${character.id}`;

    // Check cache
    if (this.spriteCache.has(cacheKey)) {
      const imageData = this.spriteCache.get(cacheKey)!;
      this.ctx.putImageData(imageData, x, y);
      return;
    }

    // Generate character sprite
    const sprite = this.generateCharacterSprite(character);
    this.spriteCache.set(cacheKey, sprite);

    this.ctx.putImageData(sprite, x, y);

    // Draw character name
    this.ctx.fillStyle = '#FFFFFF';
    this.ctx.font = '12px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.fillText(character.name, x + 16, y - 5);

    // Draw level
    this.ctx.fillStyle = '#FFD700';
    this.ctx.font = 'bold 10px Arial';
    this.ctx.fillText(`Lv.${character.level}`, x + 16, y + 40);
  }

  /**
   * Generate character sprite based on class
   */
  private generateCharacterSprite(character: GameCharacter): ImageData {
    const size = 32;
    const imageData = this.ctx!.createImageData(size, size);
    const data = imageData.data;

    // Color schemes for each class
    const colorSchemes: Record<string, { primary: number[]; secondary: number[] }> = {
      warrior: { primary: [200, 50, 50], secondary: [150, 150, 150] },
      mage: { primary: [50, 50, 200], secondary: [100, 100, 255] },
      rogue: { primary: [50, 50, 50], secondary: [100, 100, 100] },
      cleric: { primary: [255, 255, 200], secondary: [200, 200, 150] },
      ranger: { primary: [50, 150, 50], secondary: [100, 100, 50] },
      paladin: { primary: [255, 215, 0], secondary: [200, 200, 200] }
    };

    const colors = colorSchemes[character.class] || colorSchemes.warrior;

    // Simple humanoid shape
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const index = (y * size + x) * 4;

        // Head (top quarter, centered)
        if (y >= 4 && y < 12 && x >= 12 && x < 20) {
          data[index] = colors.primary[0];
          data[index + 1] = colors.primary[1];
          data[index + 2] = colors.primary[2];
          data[index + 3] = 255;
        }
        // Body (middle half, centered)
        else if (y >= 12 && y < 24 && x >= 10 && x < 22) {
          data[index] = colors.secondary[0];
          data[index + 1] = colors.secondary[1];
          data[index + 2] = colors.secondary[2];
          data[index + 3] = 255;
        }
        // Legs (bottom quarter)
        else if (y >= 24 && y < 32) {
          if ((x >= 10 && x < 14) || (x >= 18 && x < 22)) {
            data[index] = colors.primary[0] * 0.7;
            data[index + 1] = colors.primary[1] * 0.7;
            data[index + 2] = colors.primary[2] * 0.7;
            data[index + 3] = 255;
          }
        }
      }
    }

    return imageData;
  }

  /**
   * Render an item icon
   */
  renderItem(item: GameItem, x: number, y: number, size: number = 32): void {
    if (!this.ctx) {
      throw new Error('Renderer not initialized');
    }

    const cacheKey = `item:${item.id}`;

    // Check cache
    if (this.spriteCache.has(cacheKey)) {
      const imageData = this.spriteCache.get(cacheKey)!;
      this.ctx.putImageData(imageData, x, y);
      return;
    }

    // Generate item sprite
    const sprite = this.generateItemSprite(item, size);
    this.spriteCache.set(cacheKey, sprite);

    this.ctx.putImageData(sprite, x, y);

    // Draw rarity border
    const rarityColors: Record<string, string> = {
      common: '#FFFFFF',
      uncommon: '#00FF00',
      rare: '#0000FF',
      epic: '#9400D3',
      legendary: '#FF8C00',
      mythic: '#FF0000'
    };

    this.ctx.strokeStyle = rarityColors[item.rarity] || '#FFFFFF';
    this.ctx.lineWidth = 2;
    this.ctx.strokeRect(x, y, size, size);
  }

  /**
   * Generate item sprite based on type and rarity
   */
  private generateItemSprite(item: GameItem, size: number): ImageData {
    const imageData = this.ctx!.createImageData(size, size);
    const data = imageData.data;

    // Base colors for item types
    const typeColors: Record<string, number[]> = {
      weapon: [200, 50, 50],
      armor: [150, 150, 150],
      accessory: [255, 215, 0],
      consumable: [50, 200, 50],
      material: [139, 69, 19],
      key: [255, 255, 0]
    };

    const baseColor = typeColors[item.type] || [128, 128, 128];

    // Rarity multiplier for brightness
    const rarityMultipliers: Record<string, number> = {
      common: 0.7,
      uncommon: 0.85,
      rare: 1.0,
      epic: 1.15,
      legendary: 1.3,
      mythic: 1.5
    };

    const mult = rarityMultipliers[item.rarity] || 1.0;

    // Simple geometric shape based on type
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const index = (y * size + x) * 4;
        const centerX = size / 2;
        const centerY = size / 2;
        const dist = Math.sqrt((x - centerX) ** 2 + (y - centerY) ** 2);

        // Draw shape
        if (dist < size / 3) {
          data[index] = Math.min(255, baseColor[0] * mult);
          data[index + 1] = Math.min(255, baseColor[1] * mult);
          data[index + 2] = Math.min(255, baseColor[2] * mult);
          data[index + 3] = 255;
        }
      }
    }

    return imageData;
  }

  /**
   * Render a map
   */
  renderMap(map: GameMap, offsetX: number = 0, offsetY: number = 0): void {
    if (!this.ctx) {
      throw new Error('Renderer not initialized');
    }

    const tileSize = this.config.tileSize!;

    for (let y = 0; y < map.dimensions.height; y++) {
      for (let x = 0; x < map.dimensions.width; x++) {
        const tile = map.tiles[y][x];
        this.renderTile(tile, offsetX + x * tileSize, offsetY + y * tileSize);
      }
    }

    // Render spawn points
    for (const spawn of map.spawns) {
      this.renderSpawnPoint(
        spawn.entityType,
        offsetX + spawn.x * tileSize,
        offsetY + spawn.y * tileSize
      );
    }
  }

  /**
   * Render a single tile
   */
  private renderTile(tile: MapTile, x: number, y: number): void {
    if (!this.ctx) return;

    const tileSize = this.config.tileSize!;

    // Tile colors
    const tileColors: Record<string, string> = {
      grass: '#90EE90',
      water: '#4169E1',
      mountain: '#808080',
      forest: '#228B22',
      desert: '#EDC9AF',
      dungeon: '#2F4F4F'
    };

    this.ctx.fillStyle = tileColors[tile.type] || '#FFFFFF';
    this.ctx.fillRect(x, y, tileSize, tileSize);

    // Draw grid
    this.ctx.strokeStyle = '#00000022';
    this.ctx.strokeRect(x, y, tileSize, tileSize);

    // Add texture based on type
    if (tile.type === 'water') {
      this.ctx.fillStyle = '#4169E180';
      this.ctx.fillRect(x + 2, y + 2, tileSize - 4, tileSize - 4);
    }
  }

  /**
   * Render spawn point marker
   */
  private renderSpawnPoint(type: string, x: number, y: number): void {
    if (!this.ctx) return;

    const tileSize = this.config.tileSize!;
    const centerX = x + tileSize / 2;
    const centerY = y + tileSize / 2;

    // Spawn point colors
    const colors: Record<string, string> = {
      player: '#00FF00',
      enemy: '#FF0000',
      npc: '#FFFF00',
      treasure: '#FFD700'
    };

    this.ctx.fillStyle = colors[type] || '#FFFFFF';
    this.ctx.beginPath();
    this.ctx.arc(centerX, centerY, tileSize / 4, 0, Math.PI * 2);
    this.ctx.fill();

    // Draw icon letter
    this.ctx.fillStyle = '#000000';
    this.ctx.font = 'bold 12px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText(type[0].toUpperCase(), centerX, centerY);
  }

  /**
   * Clear canvas
   */
  clear(): void {
    if (!this.ctx || !this.canvas) return;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /**
   * Clear sprite cache
   */
  clearCache(): void {
    this.spriteCache.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; keys: string[] } {
    return {
      size: this.spriteCache.size,
      keys: Array.from(this.spriteCache.keys())
    };
  }
}
