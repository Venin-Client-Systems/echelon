import { EventEmitter } from 'node:events';
import { logger } from '../lib/logger.js';
import type { EchelonEvent, AgentRole, LayerMessage } from '../lib/types.js';
import { LAYER_ORDER } from '../lib/types.js';

/**
 * Message bus enforcing hierarchical adjacency.
 * Layers can only communicate with their immediate neighbors.
 */
export class MessageBus extends EventEmitter {
  private history: LayerMessage[] = [];
  private readonly MAX_HISTORY = 1000; // Cap history to prevent memory blowout

  constructor() {
    super();
    this.setMaxListeners(50);
  }

  /** Emit a typed echelon event with error boundary */
  emitEchelon(data: EchelonEvent): boolean {
    try {
      return super.emit('echelon', data);
    } catch (err) {
      logger.error('Event listener error', {
        error: err instanceof Error ? err.message : String(err),
        eventType: data.type,
      });
      // Don't throw - prevent one bad listener from crashing the bus
      return false;
    }
  }

  /** Listen for echelon events */
  onEchelon(listener: (data: EchelonEvent) => void): this {
    return super.on('echelon', listener);
  }

  /** Remove echelon event listener */
  offEchelon(listener: (data: EchelonEvent) => void): this {
    return super.off('echelon', listener);
  }

  /** Check if two roles are adjacent in the hierarchy */
  isAdjacent(from: AgentRole, to: AgentRole): boolean {
    const fromIdx = LAYER_ORDER.indexOf(from);
    const toIdx = LAYER_ORDER.indexOf(to);
    if (fromIdx === -1 || toIdx === -1) return false;
    return Math.abs(fromIdx - toIdx) === 1;
  }

  /** Route a message between layers (enforces adjacency) */
  routeMessage(msg: LayerMessage): void {
    if (!this.isAdjacent(msg.from, msg.to)) {
      throw new Error(
        `Invalid message route: ${msg.from} → ${msg.to}. Layers must be adjacent.`
      );
    }
    this.history.push(msg);

    // Cap history to prevent unbounded growth
    if (this.history.length > this.MAX_HISTORY) {
      const removed = this.history.length - this.MAX_HISTORY;
      this.history = this.history.slice(-this.MAX_HISTORY);
      logger.debug(`Trimmed message history, removed ${removed} oldest messages`);
    }

    this.emitEchelon({ type: 'message', message: msg });
  }

  /** Get message history, optionally filtered */
  getHistory(filter?: { from?: AgentRole; to?: AgentRole }): LayerMessage[] {
    if (!filter) return [...this.history];
    return this.history.filter(m => {
      if (filter.from && m.from !== filter.from) return false;
      if (filter.to && m.to !== filter.to) return false;
      return true;
    });
  }

  /** Get the last N messages for context building */
  getRecentContext(n: number): LayerMessage[] {
    return this.history.slice(-n);
  }

  /** Restore history from persisted state */
  loadHistory(messages: LayerMessage[]): void {
    // Cap loaded history to MAX_HISTORY to prevent memory issues on resume
    if (messages.length > this.MAX_HISTORY) {
      logger.info(`Loading last ${this.MAX_HISTORY} of ${messages.length} messages from state`);
      this.history = messages.slice(-this.MAX_HISTORY);
    } else {
      this.history = [...messages];
    }
  }
}
