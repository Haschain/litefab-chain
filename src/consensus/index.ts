import type { ConsensusModule, Block, TransactionEnvelope } from '../types';
import { EventEmitter } from 'node:events';

/**
 * Abstract base class for consensus modules
 */
export abstract class BaseConsensus extends EventEmitter implements ConsensusModule {
  protected onBlockCommittedCallback?: (block: Block) => void;

  abstract submitTx(tx: TransactionEnvelope): Promise<void>;

  onBlockCommitted(cb: (block: Block) => void): void {
    this.onBlockCommittedCallback = cb;
  }

  protected emitBlockCommitted(block: Block): void {
    if (this.onBlockCommittedCallback) {
      this.onBlockCommittedCallback(block);
    }
    this.emit('blockCommitted', block);
  }
}

/**
 * Raft consensus implementation
 */
export class RaftConsensus extends BaseConsensus {
  private nodeId: string;
  private clusterNodes: string[];
  private isLeader: boolean = false;
  private term: number = 0;
  private log: TransactionEnvelope[] = [];
  private commitIndex: number = -1;
  private lastApplied: number = -1;
  private blockNumber: number = 0;
  private blockTimer?: any;
  private pendingTxs: TransactionEnvelope[] = [];

  // Raft state
  private votedFor?: string;
  private votes: Set<string> = new Set();
  private electionTimer?: any;
  private heartbeatTimer?: any;

  // Configuration
  private readonly blockSize = 10; // Max transactions per block
  private readonly blockTimeout = 5000; // 5 seconds

  constructor(nodeId: string, clusterNodes: string[]) {
    super();
    this.nodeId = nodeId;
    this.clusterNodes = clusterNodes;
    this.startElectionTimer();
  }

  async submitTx(tx: TransactionEnvelope): Promise<void> {
    if (this.isLeader) {
      this.addToLog(tx);
    } else {
      // Forward to leader (in a real implementation, this would be an RPC call)
      throw new Error(`Node ${this.nodeId} is not the leader. Cannot submit transaction.`);
    }
  }

  private addToLog(tx: TransactionEnvelope): void {
    this.log.push(tx);
    this.pendingTxs.push(tx);
    this.checkBlockCreation();
  }

  private checkBlockCreation(): void {
    if (this.pendingTxs.length >= this.blockSize) {
      this.createBlock();
    } else if (!this.blockTimer && this.pendingTxs.length > 0) {
      this.blockTimer = setTimeout(() => {
        this.createBlock();
      }, this.blockTimeout);
    }
  }

  private createBlock(): void {
    if (this.blockTimer) {
      clearTimeout(this.blockTimer);
      this.blockTimer = undefined;
    }

    if (this.pendingTxs.length === 0) {
      return;
    }

    const block: Block = {
      header: {
        number: this.blockNumber++,
        previousHash: this.getPreviousBlockHash(),
        dataHash: this.calculateDataHash(this.pendingTxs)
      },
      transactions: [...this.pendingTxs],
      metadata: {
        timestamp: new Date().toISOString(),
        ordererId: this.nodeId,
        ordererSignature: '' // Would be signed in real implementation
      }
    };

    this.pendingTxs = [];
    this.commitBlock(block);
  }

  private getPreviousBlockHash(): string {
    // In a real implementation, this would fetch from storage
    return '0'; // Genesis block hash
  }

  private calculateDataHash(txs: TransactionEnvelope[]): string {
    // Simple hash of transaction data
    return txs.map(tx => tx.txId).join('|');
  }

  private commitBlock(block: Block): void {
    this.commitIndex = block.header.number;
    this.lastApplied = block.header.number;
    this.emitBlockCommitted(block);
  }

  // Raft leader election methods
  private startElectionTimer(): void {
    const timeout = this.randomTimeout(150, 300);
    this.electionTimer = setTimeout(() => {
      this.startElection();
    }, timeout);
  }

  private startElection(): void {
    this.term++;
    this.votedFor = this.nodeId;
    this.votes.clear();
    this.votes.add(this.nodeId);
    
    this.isLeader = false;
    
    // Request votes from other nodes (in a real implementation, this would be RPC calls)
    this.requestVotes();

    // Start election timer again
    this.startElectionTimer();
  }

  private requestVotes(): void {
    // Simulate vote requests - in a real implementation, this would be network calls
    for (const node of this.clusterNodes) {
      if (node !== this.nodeId) {
        // Simulate receiving votes
        setTimeout(() => {
          if (Math.random() > 0.3) { // 70% chance of getting vote
            this.votes.add(node);
            this.checkElectionWon();
          }
        }, Math.random() * 100);
      }
    }
  }

  private checkElectionWon(): void {
    const quorum = Math.floor(this.clusterNodes.length / 2) + 1;
    if (this.votes.size >= quorum && !this.isLeader) {
      this.becomeLeader();
    }
  }

  private becomeLeader(): void {
    this.isLeader = true;
    console.log(`Node ${this.nodeId} became leader for term ${this.term}`);
    
    if (this.electionTimer) {
      clearTimeout(this.electionTimer);
      this.electionTimer = undefined;
    }

    // Start heartbeat
    this.startHeartbeat();
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat();
    }, 50); // Send heartbeat every 50ms
  }

  private sendHeartbeat(): void {
    // In a real implementation, this would send AppendEntries RPC to followers
    // For now, we just continue as leader
  }

  private stepDown(): void {
    this.isLeader = false;
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
    this.startElectionTimer();
  }

  private randomTimeout(min: number, max: number): number {
    return Math.random() * (max - min) + min;
  }

  // Public methods for testing and management
  getNodeId(): string {
    return this.nodeId;
  }

  isLeaderNode(): boolean {
    return this.isLeader;
  }

  getCurrentTerm(): number {
    return this.term;
  }

  getCommitIndex(): number {
    return this.commitIndex;
  }

  // Simulate receiving a vote from another node
  receiveVote(nodeId: string, term: number): void {
    if (term === this.term && !this.votes.has(nodeId)) {
      this.votes.add(nodeId);
      this.checkElectionWon();
    } else if (term > this.term) {
      this.term = term;
      this.stepDown();
    }
  }

  // Simulate receiving an AppendEntries RPC
  receiveAppendEntries(
    leaderId: string,
    term: number,
    prevLogIndex: number,
    prevLogTerm: number,
    entries: TransactionEnvelope[],
    leaderCommit: number
  ): boolean {
    if (term > this.term) {
      this.term = term;
      this.stepDown();
    }

    if (term < this.term) {
      return false; // Reject stale term
    }

    // In a real implementation, we would check log consistency
    // For now, we just accept and update commit index
    this.commitIndex = Math.min(leaderCommit, this.log.length - 1);
    
    if (!this.electionTimer) {
      this.startElectionTimer();
    }

    return true;
  }

  // Clean shutdown
  shutdown(): void {
    if (this.electionTimer) {
      clearTimeout(this.electionTimer);
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }
    if (this.blockTimer) {
      clearTimeout(this.blockTimer);
    }
  }
}

/**
 * Export ConsensusModule for use in other modules
 */
export type { ConsensusModule };

/**
 * Solo consensus - simple single-node ordering (no leader election needed)
 */
export class SoloConsensus extends BaseConsensus {
  private nodeId: string;
  private blockNumber: number = 0;
  private pendingTxs: TransactionEnvelope[] = [];
  private blockTimer?: any;
  private readonly blockTimeout = 2000; // 2 seconds for faster testing

  constructor(nodeId: string) {
    super();
    this.nodeId = nodeId;
  }

  async submitTx(tx: TransactionEnvelope): Promise<void> {
    this.pendingTxs.push(tx);
    
    // Start block timer if not already running
    if (!this.blockTimer && this.pendingTxs.length > 0) {
      this.blockTimer = setTimeout(() => this.createBlock(), this.blockTimeout);
    }
  }

  private createBlock(): void {
    if (this.blockTimer) {
      clearTimeout(this.blockTimer);
      this.blockTimer = undefined;
    }

    if (this.pendingTxs.length === 0) return;

    const block: Block = {
      header: {
        number: this.blockNumber++,
        previousHash: '0',
        dataHash: this.pendingTxs.map(tx => tx.txId).join('|')
      },
      transactions: [...this.pendingTxs],
      metadata: {
        timestamp: new Date().toISOString(),
        ordererId: this.nodeId,
        ordererSignature: ''
      }
    };

    this.pendingTxs = [];
    this.emitBlockCommitted(block);
  }

  shutdown(): void {
    if (this.blockTimer) clearTimeout(this.blockTimer);
  }
}

/**
 * Factory for creating consensus modules
 */
export class ConsensusFactory {
  static create(
    type: 'raft' | 'pbft' | 'solo',
    nodeId: string,
    clusterNodes: string[]
  ): ConsensusModule {
    switch (type) {
      case 'solo':
        return new SoloConsensus(nodeId);
      case 'raft':
        return new RaftConsensus(nodeId, clusterNodes);
      case 'pbft':
        throw new Error('PBFT consensus not implemented yet');
      default:
        throw new Error(`Unknown consensus type: ${type}`);
    }
  }
}