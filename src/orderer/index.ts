import type { NodeConfig, TransactionEnvelope, Block } from '../types';
import { MSP } from '../msp';
import { LedgerStore } from '../storage';
import { ConsensusFactory, type ConsensusModule } from '../consensus';
import { canonicalStringify, sign, hash } from '../crypto';
import { readFileSync } from 'node:fs';

/**
 * Orderer node implementation
 */
export class Orderer {
  private config: NodeConfig;
  private msp: MSP;
  private ledgerStore: LedgerStore;
  private consensus: ConsensusModule;
  private blockCutter: BlockCutter;
  private broadcaster: Broadcaster;
  private server?: any;
  private privateKey: string;

  constructor(config: NodeConfig) {
    this.config = config;
    this.msp = new MSP(config.mspConfigPath);
    this.ledgerStore = new LedgerStore(`${config.dbPath}/ledger`);
    this.consensus = ConsensusFactory.create(
      config.consensus,
      config.nodeId,
      config.ordererCluster.nodes
    );
    this.blockCutter = new BlockCutter();
    this.broadcaster = new Broadcaster(config.peers);
    
    // Load orderer's private key
    const privateKeyPath = config.privateKeyPath || `./config/${config.nodeId}_private.key`;
    this.privateKey = readFileSync(privateKeyPath, 'utf-8');

    // Set up consensus callback
    this.consensus.onBlockCommitted((block: Block) => {
      this.onBlockCommitted(block);
    });
  }

  /**
   * Start the orderer node
   */
  async start(): Promise<void> {
    // Start RPC server
    await this.startRPCServer();
    
    console.log(`Orderer ${this.config.nodeId} started on ${this.config.listenAddr}`);
  }

  /**
   * Stop the orderer node
   */
  async stop(): Promise<void> {
    if (this.server) {
      this.server.stop();
    }
    
    if ('shutdown' in this.consensus) {
      (this.consensus as any).shutdown();
    }
    
    await this.ledgerStore.close();
    
    console.log(`Orderer ${this.config.nodeId} stopped`);
  }

  /**
   * Start the RPC server
   */
  private async startRPCServer(): Promise<void> {
    this.server = Bun.serve({
      port: this.config.listenAddr.split(':')[1] || 4000,
      fetch: async (req: Request) => {
        const url = new URL(req.url);
        
        try {
          if (url.pathname === '/submit') {
            return await this.handleSubmit(req);
          } else if (url.pathname === '/broadcast') {
            return await this.handleBroadcast(req);
          } else {
            return new Response('Not Found', { status: 404 });
          }
        } catch (error) {
          return new Response(`Error: ${error}`, { status: 500 });
        }
      }
    });
  }

  /**
   * Handle transaction submission
   */
  private async handleSubmit(req: Request): Promise<Response> {
    const tx: TransactionEnvelope = await req.json() as TransactionEnvelope;
    
    // Verify transaction signature
    const txData = canonicalStringify({
      txId: tx.txId,
      creatorId: tx.creatorId,
      creatorOrgId: tx.creatorOrgId,
      creatorPubKey: tx.creatorPubKey,
      payload: tx.payload,
      rwSet: tx.rwSet,
      result: tx.result,
      endorsements: tx.endorsements
    });
    
    const signatureValid = this.msp.verifySignature(
      txData,
      tx.clientSignature,
      tx.creatorId,
      'CLIENT'
    );
    
    if (!signatureValid.valid) {
      return new Response(`Invalid signature: ${signatureValid.error}`, { status: 400 });
    }

    // Submit to consensus
    await this.consensus.submitTx(tx);
    
    return new Response(JSON.stringify({ status: 'submitted' }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  /**
   * Handle broadcast from other orderers
   */
  private async handleBroadcast(req: Request): Promise<Response> {
    const block: Block = await req.json() as Block;
    
    // Verify block signature
    const blockData = canonicalStringify({
      header: block.header,
      transactions: block.transactions,
      metadata: {
        timestamp: block.metadata.timestamp,
        ordererId: block.metadata.ordererId
      }
    });
    
    const signatureValid = this.msp.verifySignature(
      blockData,
      block.metadata.ordererSignature,
      block.metadata.ordererId,
      'ORDERER'
    );
    
    if (!signatureValid.valid) {
      return new Response(`Invalid signature: ${signatureValid.error}`, { status: 400 });
    }

    // Store block
    await this.ledgerStore.storeBlock(block);
    
    return new Response(JSON.stringify({ status: 'stored' }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  /**
   * Handle block committed by consensus
   */
  private async onBlockCommitted(block: Block): Promise<void> {
    // Store block in local ledger
    await this.ledgerStore.storeBlock(block);

    // Sign block
    const blockData = canonicalStringify({
      header: block.header,
      transactions: block.transactions,
      metadata: {
        timestamp: block.metadata.timestamp,
        ordererId: block.metadata.ordererId
      }
    });

    // Sign with orderer's private key
    block.metadata.ordererSignature = sign(blockData, this.privateKey);

    // Broadcast to peers
    await this.broadcaster.broadcastBlock(block);

    console.log(`Orderer ${this.config.nodeId} committed block ${block.header.number}`);
  }
}

/**
 * Block cutter for creating blocks from transactions
 */
export class BlockCutter {
  private pendingTxs: TransactionEnvelope[] = [];
  private readonly maxBlockSize = 10;
  private readonly maxBatchTimeout = 5000; // 5 seconds
  private batchTimer?: any;

  /**
   * Add a transaction to the pending batch
   */
  addTransaction(tx: TransactionEnvelope): void {
    this.pendingTxs.push(tx);

    if (this.pendingTxs.length >= this.maxBlockSize) {
      this.cutBlock();
    } else if (!this.batchTimer) {
      this.batchTimer = setTimeout(() => {
        this.cutBlock();
      }, this.maxBatchTimeout);
    }
  }

  /**
   * Cut a block from pending transactions
   */
  private cutBlock(): void {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = undefined;
    }

    if (this.pendingTxs.length === 0) {
      return;
    }

    const block = this.createBlock([...this.pendingTxs]);
    this.pendingTxs = [];

    // Emit block created event
    this.emit('blockCreated', block);
  }

  /**
   * Create a block from transactions
   */
  private createBlock(txs: TransactionEnvelope[]): Block {
    const blockNumber = 0; // In practice, get from ledger
    const previousHash = '0'; // In practice, get from ledger
    
    const header = {
      number: blockNumber,
      previousHash,
      dataHash: this.calculateDataHash(txs)
    };

    const metadata = {
      timestamp: new Date().toISOString(),
      ordererId: 'orderer1', // In practice, get from config
      ordererSignature: '' // Will be filled later
    };

    return {
      header,
      transactions: txs,
      metadata
    };
  }

  /**
   * Calculate data hash for transactions
   */
  private calculateDataHash(txs: TransactionEnvelope[]): string {
    const txData = txs.map(tx => canonicalStringify(tx)).join('');
    return hash(txData);
  }

  /**
   * Simple event emitter
   */
  private listeners: { [event: string]: Function[] } = {};

  on(event: string, callback: Function): void {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(callback);
  }

  private emit(event: string, data: any): void {
    if (this.listeners[event]) {
      for (const callback of this.listeners[event]) {
        callback(data);
      }
    }
  }
}

/**
 * Broadcaster for sending blocks to peers
 */
export class Broadcaster {
  private peerAddresses: string[];

  constructor(peerAddresses: string[]) {
    this.peerAddresses = peerAddresses;
  }

  /**
   * Broadcast a block to all peers
   */
  async broadcastBlock(block: Block): Promise<void> {
    const promises = this.peerAddresses.map(async (peerAddr) => {
      try {
        const response = await fetch(`http://${peerAddr}/block`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(block)
        });

        if (!response.ok) {
          console.error(`Failed to broadcast block to peer ${peerAddr}: ${response.statusText}`);
        }
      } catch (error) {
        console.error(`Error broadcasting block to peer ${peerAddr}: ${error}`);
      }
    });

    await Promise.allSettled(promises);
  }
}