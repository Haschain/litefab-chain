import { Level } from 'level';
import type { Block, TransactionEnvelope, ReadVersion, WriteEntry } from '../types';
import { hash, canonicalStringify } from '../crypto';

export class LedgerStore {
  private db: Level<string, string>;

  constructor(dbPath: string) {
    this.db = new Level(dbPath);
  }

  /**
   * Store a block in the ledger
   */
  async storeBlock(block: Block): Promise<void> {
    const blockKey = `block:${block.header.number}`;
    await this.db.put(blockKey, JSON.stringify(block));

    // Store block hash lookup
    const blockHash = this.calculateBlockHash(block);
    await this.db.put(`hash:${blockHash}`, block.header.number.toString());

    // Update latest block number
    await this.setLatestBlockNumber(block.header.number);
  }

  /**
   * Get a block by number
   */
  async getBlock(blockNumber: number): Promise<Block | null> {
    try {
      const blockKey = `block:${blockNumber}`;
      const blockStr = await this.db.get(blockKey);
      return JSON.parse(blockStr) as Block;
    } catch (error: any) {
      if (error.code === 'LEVEL_NOT_FOUND') {
        return null;
      }
      throw error;
    }
  }

  /**
   * Get a block by hash
   */
  async getBlockByHash(blockHash: string): Promise<Block | null> {
    try {
      const blockNumberStr = await this.db.get(`hash:${blockHash}`);
      const blockNumber = parseInt(blockNumberStr);
      return this.getBlock(blockNumber);
    } catch (error: any) {
      if (error.code === 'LEVEL_NOT_FOUND') {
        return null;
      }
      throw error;
    }
  }

  /**
   * Get the latest block number
   */
  async getLatestBlockNumber(): Promise<number> {
    try {
      const latest = await this.db.get('meta:latest');
      return parseInt(latest);
    } catch (error: any) {
      if (error.code === 'LEVEL_NOT_FOUND') {
        return -1; // No blocks yet
      }
      throw error;
    }
  }

  /**
   * Set the latest block number
   */
  private async setLatestBlockNumber(blockNumber: number): Promise<void> {
    await this.db.put('meta:latest', blockNumber.toString());
  }

  /**
   * Get the genesis block
   */
  async getGenesisBlock(): Promise<Block | null> {
    return this.getBlock(0);
  }

  /**
   * Calculate block hash
   */
  private calculateBlockHash(block: Block): string {
    const headerData = canonicalStringify(block.header);
    const txData = block.transactions.map(tx => canonicalStringify(tx)).join('');
    const metadataData = canonicalStringify(block.metadata);
    return hash(headerData + txData + metadataData);
  }

  /**
   * Get transaction by ID
   */
  async getTransaction(txId: string): Promise<TransactionEnvelope | null> {
    try {
      const txKey = `tx:${txId}`;
      const txStr = await this.db.get(txKey);
      return JSON.parse(txStr) as TransactionEnvelope;
    } catch (error: any) {
      if (error.code === 'LEVEL_NOT_FOUND') {
        return null;
      }
      throw error;
    }
  }

  /**
   * Store transaction index
   */
  async storeTransactionIndex(txId: string, blockNumber: number, txNumber: number): Promise<void> {
    const txKey = `tx:${txId}`;
    const txLocation = { blockNumber, txNumber };
    await this.db.put(txKey, JSON.stringify(txLocation));
  }

  /**
   * Close the database
   */
  async close(): Promise<void> {
    await this.db.close();
  }
}

export class WorldStateStore {
  private db: Level<string, string>;
  private channelId: string;

  constructor(dbPath: string, channelId: string = 'default') {
    this.db = new Level(dbPath);
    this.channelId = channelId;
  }

  /**
   * Get state value for a key
   */
  async getState(key: string): Promise<string | null> {
    try {
      const stateKey = `state:${this.channelId}:${key}`;
      return await this.db.get(stateKey);
    } catch (error: any) {
      if (error.code === 'LEVEL_NOT_FOUND') {
        return null;
      }
      throw error;
    }
  }

  /**
   * Set state value for a key
   */
  async setState(key: string, value: string): Promise<void> {
    const stateKey = `state:${this.channelId}:${key}`;
    await this.db.put(stateKey, value);
  }

  /**
   * Delete state for a key
   */
  async deleteState(key: string): Promise<void> {
    const stateKey = `state:${this.channelId}:${key}`;
    await this.db.del(stateKey);
  }

  /**
   * Get version information for a key
   */
  async getVersion(key: string): Promise<{ blockNum: number; txNum: number } | null> {
    try {
      const versionKey = `version:${this.channelId}:${key}`;
      const versionStr = await this.db.get(versionKey);
      if (!versionStr || versionStr === 'undefined') {
        return null;
      }
      return JSON.parse(versionStr) as { blockNum: number; txNum: number };
    } catch (error: any) {
      if (error.code === 'LEVEL_NOT_FOUND') {
        return null;
      }
      throw error;
    }
  }

  /**
   * Set version information for a key
   */
  async setVersion(key: string, version: { blockNum: number; txNum: number }): Promise<void> {
    const versionKey = `version:${this.channelId}:${key}`;
    await this.db.put(versionKey, JSON.stringify(version));
  }

  /**
   * Apply read-write set to world state
   */
  async applyRWSet(
    rwSet: { reads: ReadVersion[]; writes: WriteEntry[] },
    blockNumber: number,
    txNumber: number
  ): Promise<void> {
    // Apply writes
    for (const write of rwSet.writes) {
      if (write.value === null) {
        // Delete operation
        await this.deleteState(write.key);
        await this.setVersion(write.key, { blockNum: blockNumber, txNum: txNumber });
      } else {
        // Set operation
        await this.setState(write.key, write.value);
        await this.setVersion(write.key, { blockNum: blockNumber, txNum: txNumber });
      }
    }
  }

  /**
   * Validate read set against current versions (MVCC check)
   */
  async validateReadSet(reads: ReadVersion[]): Promise<boolean> {
    for (const read of reads) {
      const currentVersion = await this.getVersion(read.key);
      
      if (read.version === null && currentVersion !== null) {
        // Expected no version but found one
        return false;
      }
      
      if (read.version !== null && currentVersion === null) {
        // Expected version but found none
        return false;
      }
      
      if (read.version !== null && currentVersion !== null) {
        // Check if versions match
        if (read.version.blockNum !== currentVersion.blockNum ||
            read.version.txNum !== currentVersion.txNum) {
          return false;
        }
      }
    }
    return true;
  }

  /**
   * Get all keys with a prefix
   */
  async getKeysByPrefix(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    const statePrefix = `state:${this.channelId}:${prefix}`;
    
    for await (const [key] of this.db.iterator({ gt: statePrefix, lt: statePrefix + '\uffff' })) {
      const keyWithoutPrefix = key.substring(`state:${this.channelId}:`.length);
      keys.push(keyWithoutPrefix);
    }
    
    return keys;
  }

  /**
   * Close the database
   */
  async close(): Promise<void> {
    await this.db.close();
  }
}