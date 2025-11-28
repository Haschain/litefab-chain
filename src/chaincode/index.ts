import type { Chaincode, ChaincodeContext, TxPayload, RWSet, ReadVersion, WriteEntry } from '../types';
import { WorldStateStore } from '../storage';
import { generateTxId } from '../crypto';

export class ChaincodeHost {
  private chaincodes: Map<string, Chaincode> = new Map();
  private worldState: WorldStateStore;

  constructor(worldState: WorldStateStore) {
    this.worldState = worldState;
  }

  /**
   * Register a chaincode
   */
  registerChaincode(chaincodeId: string, chaincode: Chaincode): void {
    this.chaincodes.set(chaincodeId, chaincode);
  }

  /**
   * Load chaincode from file (for MVP, chaincodes are pre-installed)
   */
  async loadChaincode(chaincodeId: string, chaincodeRoot: string): Promise<void> {
    try {
      // Resolve to absolute path for dynamic import
      const absoluteRoot = chaincodeRoot.startsWith('/') 
        ? chaincodeRoot 
        : `${process.cwd()}/${chaincodeRoot}`;
      const modulePath = `${absoluteRoot}/${chaincodeId}/index.ts`;
      const chaincodeModule = await import(modulePath);
      
      if (chaincodeModule.chaincode) {
        this.registerChaincode(chaincodeId, chaincodeModule.chaincode);
      } else {
        throw new Error(`Chaincode ${chaincodeId} does not export a 'chaincode' object`);
      }
    } catch (error) {
      throw new Error(`Failed to load chaincode ${chaincodeId}: ${error}`);
    }
  }

  /**
   * Execute a chaincode transaction (simulation)
   */
  async executeTransaction(
    chaincodeId: string,
    payload: TxPayload,
    creatorId: string,
    creatorOrgId: string
  ): Promise<{ rwSet: RWSet; result: string | null }> {
    const chaincode = this.chaincodes.get(chaincodeId);
    if (!chaincode) {
      throw new Error(`Chaincode ${chaincodeId} not found`);
    }

    const txId = generateTxId();
    const context = new ChaincodeExecutionContext(
      txId,
      creatorId,
      creatorOrgId,
      this.worldState
    );

    let result: string | null = null;

    try {
      if (payload.type === 'DEPLOY_CHAINCODE') {
        // For deploy, call init if available
        if (chaincode.init) {
          const initResult = await chaincode.init(context, payload.args || []);
          result = initResult || null;
        }
      } else if (payload.type === 'INVOKE_CHAINCODE') {
        // For invoke, call the specific function
        if (payload.functionName) {
          const invokeResult = await chaincode.invoke(context, payload.functionName, payload.args || []);
          result = invokeResult || null;
        } else {
          throw new Error('Function name not provided for INVOKE_CHAINCODE');
        }
      }

      return {
        rwSet: context.getRWSet(),
        result
      };
    } catch (error) {
      throw new Error(`Chaincode execution failed: ${error}`);
    }
  }

  /**
   * Check if a chaincode is registered
   */
  hasChaincode(chaincodeId: string): boolean {
    return this.chaincodes.has(chaincodeId);
  }
}

class ChaincodeExecutionContext implements ChaincodeContext {
  public readonly txId: string;
  public readonly clientId: string;
  public readonly clientOrgId: string;
  
  private worldState: WorldStateStore;
  private readSet: ReadVersion[] = [];
  private writeSet: WriteEntry[] = [];

  constructor(
    txId: string,
    clientId: string,
    clientOrgId: string,
    worldState: WorldStateStore
  ) {
    this.txId = txId;
    this.clientId = clientId;
    this.clientOrgId = clientOrgId;
    this.worldState = worldState;
  }

  async getState(key: string): Promise<string | null> {
    // Record the read with current version
    const version = await this.worldState.getVersion(key);
    this.readSet.push({ key, version });
    
    // Return the current value
    return await this.worldState.getState(key);
  }

  async putState(key: string, value: string): Promise<void> {
    // Record the write
    this.writeSet.push({ key, value });
  }

  async delState(key: string): Promise<void> {
    // Record the delete
    this.writeSet.push({ key, value: null });
  }

  /**
   * Get the read-write set for this transaction
   */
  getRWSet(): RWSet {
    return {
      reads: this.readSet,
      writes: this.writeSet
    };
  }
}

/**
 * Chaincode metadata storage
 */
export class ChaincodeMetadataStore {
  private worldState: WorldStateStore;

  constructor(worldState: WorldStateStore) {
    this.worldState = worldState;
  }

  /**
   * Store chaincode metadata
   */
  async storeChaincodeMetadata(
    chaincodeId: string,
    version: string,
    endorsementPolicy: any
  ): Promise<void> {
    const metadata = {
      chaincodeId,
      version,
      endorsementPolicy,
      deployedAt: new Date().toISOString()
    };

    await this.worldState.setState(`CHAINCODE:${chaincodeId}`, JSON.stringify(metadata));
  }

  /**
   * Get chaincode metadata
   */
  async getChaincodeMetadata(chaincodeId: string): Promise<any | null> {
    const metadataStr = await this.worldState.getState(`CHAINCODE:${chaincodeId}`);
    return metadataStr ? JSON.parse(metadataStr) : null;
  }

  /**
   * Check if chaincode exists
   */
  async chaincodeExists(chaincodeId: string): Promise<boolean> {
    const metadata = await this.getChaincodeMetadata(chaincodeId);
    return metadata !== null;
  }

  /**
   * Get all chaincodes
   */
  async getAllChaincodes(): Promise<string[]> {
    return await this.worldState.getKeysByPrefix('CHAINCODE:');
  }
}