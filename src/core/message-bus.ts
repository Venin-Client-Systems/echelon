import { EventEmitter } from 'node:events';
import type { EchelonEvent, AgentRole, LayerMessage } from '../lib/types.js';
import { LAYER_ORDER } from '../lib/types.js';

/**
 * Message bus enforcing hierarchical adjacency.
 * Layers can only communicate with their immediate neighbors.
 */
export class MessageBus extends EventEmitter {
  private history: LayerMessage[] = [];

  constructor() {
    super();
    this.setMaxListeners(50);
  }

  /** Emit a typed echelon event */
  emitEchelon(data: EchelonEvent): boolean {
    return super.emit('echelon', data);
  }

  /** Listen for echelon events */
  onEchelon(listener: (data: EchelonEvent) => void): this {
    return super.on('echelon', listener);
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
    this.history = [...messages];
  }
}
