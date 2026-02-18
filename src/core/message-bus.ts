import { EventEmitter } from 'node:events';
import { logger } from '../lib/logger.js';
import type { EchelonEvent, AgentRole, LayerMessage } from '../lib/types.js';
import { LAYER_ORDER } from '../lib/types.js';

/**
 * Message bus enforcing hierarchical adjacency in the Echelon orchestrator.
 *
 * The MessageBus is a synchronous EventEmitter that routes messages between layers
 * and enforces the hierarchical constraint that layers can only communicate with
 * their immediate neighbors (CEO ↔ 2IC, 2IC ↔ Eng Lead, etc.).
 *
 * @category Core
 * @example
 * ```typescript
 * const bus = new MessageBus();
 * bus.onEchelon((event) => {
 *   if (event.type === 'message') {
 *     console.log(`${event.message.from} → ${event.message.to}: ${event.message.content}`);
 *   }
 * });
 *
 * bus.routeMessage({
 *   from: '2ic',
 *   to: 'eng-lead',
 *   content: 'Design the auth system',
 * });
 * ```
 */
export class MessageBus extends EventEmitter {
  private history: LayerMessage[] = [];
  private readonly MAX_HISTORY = 1000; // Cap history to prevent memory blowout

  constructor() {
    super();
    this.setMaxListeners(50);
  }

  /**
   * Emit a typed Echelon event with error boundary protection.
   *
   * All system events (agent status changes, actions, issues, etc.) flow through this method.
   * If a listener throws an error, it's logged but doesn't crash the bus.
   *
   * @param data - The event to emit
   * @returns true if listeners were called, false if error occurred
   */
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

  /**
   * Register a listener for Echelon events.
   *
   * @param listener - Callback function that receives event data
   * @returns The MessageBus instance for chaining
   */
  onEchelon(listener: (data: EchelonEvent) => void): this {
    return super.on('echelon', listener);
  }

  /**
   * Remove an Echelon event listener.
   *
   * @param listener - The callback function to remove
   * @returns The MessageBus instance for chaining
   */
  offEchelon(listener: (data: EchelonEvent) => void): this {
    return super.off('echelon', listener);
  }

  /**
   * Check if two roles are adjacent in the organizational hierarchy.
   *
   * Adjacent roles can communicate directly (e.g., CEO ↔ 2IC, 2IC ↔ Eng Lead).
   * Non-adjacent communication must use the `escalate` or `request_info` actions.
   *
   * @param from - The source role
   * @param to - The destination role
   * @returns true if roles are adjacent in LAYER_ORDER
   */
  isAdjacent(from: AgentRole, to: AgentRole): boolean {
    const fromIdx = LAYER_ORDER.indexOf(from);
    const toIdx = LAYER_ORDER.indexOf(to);
    if (fromIdx === -1 || toIdx === -1) return false;
    return Math.abs(fromIdx - toIdx) === 1;
  }

  /**
   * Route a message between layers with adjacency enforcement.
   *
   * Messages are added to history and emitted as events. The history is capped
   * at MAX_HISTORY (1000 messages) to prevent memory blowout.
   *
   * @param msg - The layer message to route
   * @throws {Error} If from and to are not adjacent roles
   */
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

  /**
   * Get message history with optional filtering.
   *
   * @param filter - Optional filter for from/to roles
   * @returns Array of matching messages (newest last)
   */
  getHistory(filter?: { from?: AgentRole; to?: AgentRole }): LayerMessage[] {
    if (!filter) return [...this.history];
    return this.history.filter(m => {
      if (filter.from && m.from !== filter.from) return false;
      if (filter.to && m.to !== filter.to) return false;
      return true;
    });
  }

  /**
   * Get the last N messages for building agent context.
   *
   * @param n - Number of recent messages to retrieve
   * @returns Array of the most recent N messages
   */
  getRecentContext(n: number): LayerMessage[] {
    return this.history.slice(-n);
  }

  /**
   * Restore message history from persisted session state.
   *
   * If the loaded history exceeds MAX_HISTORY, only the most recent messages are kept.
   *
   * @param messages - Array of messages from saved state
   */
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
