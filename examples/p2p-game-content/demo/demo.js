/**
 * P2P Game Content Generator - Browser Demo
 */

import P2PGameContentManager from '../dist/index.js';

class GameDemo {
  constructor() {
    this.manager = null;
    this.components = null;
    this.logEntries = [];
    this.maxLogEntries = 100;
    this.generatedContent = [];
  }

  async initialize() {
    try {
      this.log('Initializing P2P Game Content Generator...', 'info');

      // Create manager
      this.manager = new P2PGameContentManager();

      // Get canvas
      const canvas = document.getElementById('game-canvas');

      // Initialize
      await this.manager.initialize(canvas);

      // Get components
      this.components = this.manager.getComponents();

      // Display peer ID
      document.getElementById('peer-id').textContent = this.components.network.getStats().peerId;

      this.log('✓ System initialized successfully', 'success');

      // Setup event listeners
      this.setupEventListeners();
      this.setupComponentEvents();

      // Start update loop
      this.startUpdateLoop();

      this.log('✓ Ready to generate content!', 'success');
    } catch (error) {
      this.log(`✗ Initialization failed: ${error.message}`, 'error');
      console.error(error);
    }
  }

  setupEventListeners() {
    // Generation buttons
    document.querySelectorAll('.gen-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const type = btn.dataset.type;
        this.generateContent(type);
      });
    });

    // Connect button
    document.getElementById('connect-btn').addEventListener('click', () => {
      const peerId = document.getElementById('connect-peer-id').value.trim();
      if (peerId) {
        this.connectToPeer(peerId);
      }
    });

    // Canvas controls
    document.getElementById('clear-canvas').addEventListener('click', () => {
      this.components.renderer.clear();
      this.log('Canvas cleared', 'info');
    });

    document.getElementById('render-map').addEventListener('click', () => {
      this.renderSampleMap();
    });

    // Clear log
    document.getElementById('clear-log').addEventListener('click', () => {
      this.logEntries = [];
      document.getElementById('log-console').innerHTML = '';
    });
  }

  setupComponentEvents() {
    // Content generation events
    this.components.generator.on('content-generated', ({ type, contentId, time }) => {
      this.log(`Generated ${type} in ${time.toFixed(2)}ms`, 'success');
      this.updateMetric('gen-time', `${time.toFixed(2)}ms`);
    });

    this.components.generator.on('performance-warning', ({ type, target, actual }) => {
      this.log(`⚠ Generation time exceeded target: ${actual.toFixed(2)}ms > ${target}ms`, 'warn');
    });

    // Network events
    this.components.network.on('peer-connected', ({ peerId }) => {
      this.log(`Peer connected: ${peerId}`, 'success');
      this.updateNetworkStats();
    });

    this.components.network.on('peer-disconnected', ({ peerId }) => {
      this.log(`Peer disconnected: ${peerId}`, 'warn');
      this.updateNetworkStats();
    });

    this.components.network.on('gossip-received', ({ content, originPeer }) => {
      this.log(`Received gossip from ${originPeer.substring(0, 8)}...`, 'info');
    });

    // Validator events
    this.components.validator.on('validation-complete', ({ contentId, consensus, time, votes }) => {
      const status = consensus ? '✓' : '✗';
      this.log(`${status} Validation complete in ${time.toFixed(2)}ms (${votes} votes)`, consensus ? 'success' : 'warn');
      this.updateMetric('consensus-time', `${time.toFixed(2)}ms`);
    });

    this.components.validator.on('vote-received', ({ validationId, totalVotes }) => {
      this.log(`Vote received (${totalVotes} total)`, 'info');
    });

    // Preference events
    this.components.preferences.on('content-rated', ({ contentId, rating, totalRatings }) => {
      this.log(`Content rated ${rating}/5 (total: ${totalRatings})`, 'info');
      this.updatePreferenceStats();
    });

    this.components.preferences.on('personalization-enabled', ({ playerId, preferences }) => {
      this.log('✓ Personalization enabled!', 'success');
      document.getElementById('personalization-status').textContent = 'Enabled';
      this.updateLearnedPreferences(preferences);
    });

    // Game state events
    this.components.gameState.on('player-updated', ({ playerId, player }) => {
      this.log(`Player updated: ${playerId.substring(0, 8)}...`, 'info');
    });

    this.components.gameState.on('content-synced', ({ contentCount }) => {
      this.log(`Content synchronized (${contentCount} items)`, 'info');
      this.updateMetric('total-content', contentCount.toString());
    });
  }

  async generateContent(type) {
    try {
      this.log(`Generating ${type}...`, 'info');

      // Get preferences
      const favoriteClass = document.getElementById('pref-class').value;
      const difficulty = document.getElementById('pref-difficulty').value;

      const params = {};
      if (favoriteClass) params.class = favoriteClass;
      if (difficulty) params.difficulty = difficulty;

      // Generate
      const content = await this.manager.generateContent(type, params);

      // Add to list
      this.addContentToList(content, type);

      this.log(`✓ ${type} generated successfully`, 'success');

      // Render if applicable
      if (type === 'character') {
        this.components.renderer.clear();
        this.components.renderer.renderCharacter(content, 100, 100);
      } else if (type === 'item') {
        this.components.renderer.renderItem(content, 100, 100, 64);
      } else if (type === 'map') {
        this.components.renderer.clear();
        this.components.renderer.renderMap(content);
      }
    } catch (error) {
      this.log(`✗ Failed to generate ${type}: ${error.message}`, 'error');
      console.error(error);
    }
  }

  addContentToList(content, type) {
    const contentList = document.getElementById('content-list');

    const contentItem = document.createElement('div');
    contentItem.className = 'content-item';

    const header = document.createElement('div');
    header.className = 'content-item-header';

    const title = document.createElement('div');
    title.className = 'content-item-title';
    title.textContent = content.name || content.title || `${type} #${content.id.substring(0, 6)}`;

    const typeLabel = document.createElement('div');
    typeLabel.className = 'content-item-type';
    typeLabel.textContent = type;

    header.appendChild(title);
    header.appendChild(typeLabel);

    const body = document.createElement('div');
    body.className = 'content-item-body';
    body.textContent = this.getContentDescription(content, type);

    const actions = document.createElement('div');
    actions.className = 'content-item-actions';

    // Rating buttons
    for (let i = 1; i <= 5; i++) {
      const btn = document.createElement('button');
      btn.className = 'rating-btn';
      btn.textContent = `${i}⭐`;
      btn.addEventListener('click', () => {
        this.rateContent(content, i, actions);
      });
      actions.appendChild(btn);
    }

    contentItem.appendChild(header);
    contentItem.appendChild(body);
    contentItem.appendChild(actions);

    contentList.insertBefore(contentItem, contentList.firstChild);

    // Store content
    this.generatedContent.push({ content, type, element: contentItem });
  }

  getContentDescription(content, type) {
    if (type === 'character') {
      return `${content.class} - Level ${content.level} | HP: ${content.stats.hp}, ATK: ${content.stats.atk}, DEF: ${content.stats.def}`;
    } else if (type === 'quest') {
      return `${content.difficulty} - ${content.description} | Reward: ${content.rewards.gold} gold`;
    } else if (type === 'item') {
      return `${content.rarity} ${content.type} - ${content.description}`;
    } else if (type === 'map') {
      return `${content.dimensions.width}x${content.dimensions.height} tiles`;
    } else if (type === 'dialog') {
      return `Conversation with ${content.npcName} (${content.lines.length} lines)`;
    }
    return 'Generated content';
  }

  async rateContent(content, rating, actionsElement) {
    try {
      await this.manager.rateContent(content, rating);

      // Update button states
      actionsElement.querySelectorAll('.rating-btn').forEach((btn, index) => {
        if (index === rating - 1) {
          btn.classList.add('active');
        } else {
          btn.classList.remove('active');
        }
      });

      this.log(`Rated content ${rating}/5`, 'success');
    } catch (error) {
      this.log(`Failed to rate content: ${error.message}`, 'error');
    }
  }

  async connectToPeer(peerId) {
    try {
      this.log(`Connecting to peer ${peerId}...`, 'info');
      await this.manager.connectToPeer(peerId);
      this.log(`✓ Connected to peer`, 'success');
      document.getElementById('connect-peer-id').value = '';
    } catch (error) {
      this.log(`✗ Connection failed: ${error.message}`, 'error');
    }
  }

  async renderSampleMap() {
    try {
      const content = await this.components.generator.generateContent({
        type: 'map',
        params: { width: 24, height: 18 }
      });

      this.components.renderer.clear();
      this.components.renderer.renderMap(content);

      this.log('Sample map rendered', 'success');
    } catch (error) {
      this.log(`Failed to render map: ${error.message}`, 'error');
    }
  }

  updateNetworkStats() {
    const stats = this.components.network.getStats();
    document.getElementById('peer-count').textContent = stats.connectedPeers.toString();
    document.getElementById('network-latency').textContent = `${stats.avgLatency.toFixed(0)}ms`;

    const gameStats = this.components.gameState.getStats();
    document.getElementById('online-players').textContent = gameStats.onlinePlayers.toString();
  }

  updatePreferenceStats() {
    const stats = this.components.preferences.getStats();
    document.getElementById('total-ratings').textContent = stats.totalRatings.toString();
    document.getElementById('avg-rating').textContent = stats.avgRating.toFixed(1);

    if (Object.keys(stats.preferences).length > 0) {
      this.updateLearnedPreferences(stats.preferences);
    }
  }

  updateLearnedPreferences(preferences) {
    const container = document.getElementById('learned-prefs-list');
    const prefs = [];

    if (preferences.favoriteClasses && preferences.favoriteClasses.length > 0) {
      prefs.push(`Classes: ${preferences.favoriteClasses.join(', ')}`);
    }
    if (preferences.preferredDifficulty) {
      prefs.push(`Difficulty: ${preferences.preferredDifficulty}`);
    }
    if (preferences.contentTags && preferences.contentTags.length > 0) {
      prefs.push(`Tags: ${preferences.contentTags.join(', ')}`);
    }

    container.textContent = prefs.length > 0 ? prefs.join(' | ') : 'Learning...';
  }

  updateMetric(id, value) {
    const element = document.getElementById(id);
    if (element) {
      element.textContent = value;
    }
  }

  startUpdateLoop() {
    setInterval(() => {
      this.updateNetworkStats();
      this.updatePreferenceStats();

      const stats = this.manager.getStats();
      if (stats.gameState) {
        this.updateMetric('total-content', stats.gameState.sharedContent.toString());
      }
    }, 1000);
  }

  log(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = { message, type, timestamp };

    this.logEntries.push(logEntry);
    if (this.logEntries.length > this.maxLogEntries) {
      this.logEntries.shift();
    }

    const logConsole = document.getElementById('log-console');
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    entry.innerHTML = `<span class="timestamp">[${timestamp}]</span> ${message}`;

    logConsole.appendChild(entry);
    logConsole.scrollTop = logConsole.scrollHeight;
  }
}

// Initialize demo when page loads
window.addEventListener('DOMContentLoaded', async () => {
  const demo = new GameDemo();
  await demo.initialize();

  // Make demo accessible globally for debugging
  window.gameDemo = demo;
});
