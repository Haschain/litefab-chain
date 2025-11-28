import type { 
  NodeConfig, 
  Proposal, 
  ProposalResponse, 
  TransactionEnvelope, 
  Block, 
  Endorsement,
  EndorsementPolicy,
  ValidationCode
} from '../types';
import { MSP } from '../msp';
import { LedgerStore, WorldStateStore } from '../storage';
import { ChaincodeHost, ChaincodeMetadataStore } from '../chaincode';
import { sign, canonicalStringify, generateTxId } from '../crypto';
import { readFileSync } from 'node:fs';

/**
 * Peer node implementation
 */
export class Peer {
  private config: NodeConfig;
  private msp: MSP;
  private ledgerStore: LedgerStore;
  private worldStateStore: WorldStateStore;
  private chaincodeHost: ChaincodeHost;
  private chaincodeMetadataStore: ChaincodeMetadataStore;
  private endorser: Endorser;
  private committer: Committer;
  private server?: any;
  private privateKey: string;

  constructor(config: NodeConfig) {
    this.config = config;
    this.msp = new MSP(config.mspConfigPath);
    this.ledgerStore = new LedgerStore(`${config.dbPath}/ledger`);
    this.worldStateStore = new WorldStateStore(`${config.dbPath}/worldstate`);
    this.chaincodeMetadataStore = new ChaincodeMetadataStore(this.worldStateStore);
    this.chaincodeHost = new ChaincodeHost(this.worldStateStore);
    
    // Load peer's private key
    const privateKeyPath = config.privateKeyPath || `./config/${config.nodeId}_private.key`;
    this.privateKey = readFileSync(privateKeyPath, 'utf-8');
    
    this.endorser = new Endorser(this.msp, this.chaincodeHost, this.chaincodeMetadataStore, config.nodeId, this.privateKey);
    this.committer = new Committer(this.msp, this.ledgerStore, this.worldStateStore, this.chaincodeMetadataStore);
  }

  /**
   * Start the peer node
   */
  async start(): Promise<void> {
    // Load pre-installed chaincodes
    await this.loadChaincodes();

    // Start RPC server
    await this.startRPCServer();
    
    console.log(`Peer ${this.config.nodeId} started on ${this.config.listenAddr}`);
  }

  /**
   * Stop the peer node
   */
  async stop(): Promise<void> {
    if (this.server) {
      this.server.stop();
    }
    
    await this.ledgerStore.close();
    await this.worldStateStore.close();
    
    console.log(`Peer ${this.config.nodeId} stopped`);
  }

  /**
   * Load pre-installed chaincodes
   */
  private async loadChaincodes(): Promise<void> {
    // For MVP, we assume chaincodes are pre-installed
    // In a real implementation, this would scan the chaincode directory
    try {
      await this.chaincodeHost.loadChaincode('basic', this.config.chaincodeRoot);
      console.log(`Loaded chaincode: basic`);
    } catch (error) {
      console.log(`Failed to load chaincode basic: ${error}`);
    }
  }

  /**
   * Start the RPC server
   */
  private async startRPCServer(): Promise<void> {
    this.server = Bun.serve({
      port: this.config.listenAddr.split(':')[1] || 3000,
      fetch: async (req: Request) => {
        const url = new URL(req.url);
        
        try {
          if (url.pathname === '/proposal') {
            return await this.handleProposal(req);
          } else if (url.pathname === '/submit') {
            return await this.handleSubmit(req);
          } else if (url.pathname === '/query') {
            return await this.handleQuery(req);
          } else if (url.pathname === '/block') {
            return await this.handleBlock(req);
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
   * Handle proposal request
   */
  private async handleProposal(req: Request): Promise<Response> {
    const proposal: Proposal = await req.json() as Proposal;
    
    // Verify proposal signature
    const proposalData = canonicalStringify({
      txId: proposal.txId,
      creatorId: proposal.creatorId,
      creatorOrgId: proposal.creatorOrgId,
      creatorPubKey: proposal.creatorPubKey,
      payload: proposal.payload
    });
    
    const signatureValid = this.msp.verifySignature(
      proposalData,
      proposal.signature,
      proposal.creatorId,
      'CLIENT'
    );
    
    if (!signatureValid.valid) {
      return new Response(`Invalid signature: ${signatureValid.error}`, { status: 400 });
    }

    // Process proposal
    const response = await this.endorser.processProposal(proposal);
    
    return new Response(JSON.stringify(response), {
      headers: { 'Content-Type': 'application/json' }
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

    // Submit to orderer (in a real implementation, this would be an RPC call)
    // For now, we just acknowledge receipt
    return new Response(JSON.stringify({ status: 'received' }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  /**
   * Handle query request
   */
  private async handleQuery(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const key = url.searchParams.get('key');
    
    if (!key) {
      return new Response('Missing key parameter', { status: 400 });
    }

    const value = await this.worldStateStore.getState(key);
    
    return new Response(JSON.stringify({ value }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  /**
   * Handle block from orderer
   */
  private async handleBlock(req: Request): Promise<Response> {
    const block: Block = await req.json() as Block;
    
    try {
      await this.processBlock(block);
      return new Response(JSON.stringify({ status: 'committed' }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      return new Response(`Error committing block: ${error}`, { status: 500 });
    }
  }

  /**
   * Process a block from the ordering service
   */
  async processBlock(block: Block): Promise<void> {
    await this.committer.commitBlock(block);
  }
}

/**
 * Endorser component
 */
export class Endorser {
  private msp: MSP;
  private chaincodeHost: ChaincodeHost;
  private chaincodeMetadataStore: ChaincodeMetadataStore;
  private peerId: string;
  private peerPrivateKey: string;

  constructor(
    msp: MSP,
    chaincodeHost: ChaincodeHost,
    chaincodeMetadataStore: ChaincodeMetadataStore,
    peerId: string,
    peerPrivateKey: string
  ) {
    this.msp = msp;
    this.chaincodeHost = chaincodeHost;
    this.chaincodeMetadataStore = chaincodeMetadataStore;
    this.peerId = peerId;
    this.peerPrivateKey = peerPrivateKey;
  }

  /**
   * Process a proposal and return endorsement
   */
  async processProposal(proposal: Proposal): Promise<ProposalResponse> {
    const { payload, creatorId, creatorOrgId } = proposal;

    // Check if chaincode exists (for invoke)
    if (payload.type === 'INVOKE_CHAINCODE') {
      const chaincodeExists = await this.chaincodeMetadataStore.chaincodeExists(payload.chaincodeId);
      if (!chaincodeExists) {
        throw new Error(`Chaincode ${payload.chaincodeId} not deployed`);
      }
    }

    // Execute the transaction
    const { rwSet, result } = await this.chaincodeHost.executeTransaction(
      payload.chaincodeId,
      payload,
      creatorId,
      creatorOrgId
    );

    // Create endorsement using peer's identity
    const endorsementData = canonicalStringify({
      proposal: {
        txId: proposal.txId,
        payload: proposal.payload
      },
      rwSet,
      result
    });

    const peerIdentity = this.msp.getIdentity(this.peerId);
    if (!peerIdentity) {
      throw new Error(`Peer identity ${this.peerId} not found`);
    }

    const endorsement: Endorsement = {
      endorserId: peerIdentity.id,
      endorserOrgId: peerIdentity.orgId,
      signature: sign(endorsementData, this.peerPrivateKey)
    };

    return {
      proposal,
      rwSet,
      result,
      endorsement
    };
  }
}

/**
 * Committer component
 */
export class Committer {
  private msp: MSP;
  private ledgerStore: LedgerStore;
  private worldStateStore: WorldStateStore;
  private chaincodeMetadataStore: ChaincodeMetadataStore;

  constructor(
    msp: MSP,
    ledgerStore: LedgerStore,
    worldStateStore: WorldStateStore,
    chaincodeMetadataStore: ChaincodeMetadataStore
  ) {
    this.msp = msp;
    this.ledgerStore = ledgerStore;
    this.worldStateStore = worldStateStore;
    this.chaincodeMetadataStore = chaincodeMetadataStore;
  }

  /**
   * Commit a block to the ledger
   */
  async commitBlock(block: Block): Promise<void> {
    const validationInfo: Array<{ txId: string; code: ValidationCode; message?: string }> = [];

    // Validate each transaction
    for (let i = 0; i < block.transactions.length; i++) {
      const tx = block.transactions[i];
      if (!tx) continue;
      
      const validation = await this.validateTransaction(tx, block.header.number, i);
      validationInfo.push({
        txId: tx.txId,
        code: validation.code,
        message: validation.message
      });

      // Apply to world state if valid
      if (validation.code === 'VALID') {
        await this.worldStateStore.applyRWSet(tx.rwSet, block.header.number, i);
        
        // Store chaincode metadata for deploy transactions
        if (tx.payload.type === 'DEPLOY_CHAINCODE') {
          await this.chaincodeMetadataStore.storeChaincodeMetadata(
            tx.payload.chaincodeId,
            '1.0',
            tx.payload.endorsementPolicy || { type: 'ANY', orgs: [tx.creatorOrgId] }
          );
        }
      }
    }

    // Update block metadata with validation info
    block.metadata.validationInfo = validationInfo;

    // Store block
    await this.ledgerStore.storeBlock(block);

    console.log(`Committed block ${block.header.number} with ${block.transactions.length} transactions`);
  }

  /**
   * Validate a transaction
   */
  private async validateTransaction(
    tx: TransactionEnvelope,
    blockNumber: number,
    txNumber: number
  ): Promise<{ code: ValidationCode; message?: string }> {
    // Verify creator signature
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
      return { code: 'MSP_VALIDATION_FAILED', message: signatureValid.error };
    }

    // Verify endorsements
    const endorsementValidation = await this.validateEndorsements(tx);
    if (endorsementValidation.code !== 'VALID') {
      return endorsementValidation;
    }

    // MVCC check
    const mvccValid = await this.worldStateStore.validateReadSet(tx.rwSet.reads);
    if (!mvccValid) {
      return { code: 'MVCC_READ_CONFLICT', message: 'Read set validation failed' };
    }

    return { code: 'VALID' };
  }

  /**
   * Validate transaction endorsements
   */
  private async validateEndorsements(tx: TransactionEnvelope): Promise<{ code: ValidationCode; message?: string }> {
    // Get endorsement policy
    let endorsementPolicy: EndorsementPolicy;
    
    if (tx.payload.type === 'DEPLOY_CHAINCODE') {
      endorsementPolicy = tx.payload.endorsementPolicy || { type: 'ANY', orgs: [tx.creatorOrgId] };
    } else {
      // Get policy from chaincode metadata
      const metadata = await this.chaincodeMetadataStore.getChaincodeMetadata(tx.payload.chaincodeId);
      if (!metadata) {
        return { code: 'BAD_PAYLOAD', message: 'Chaincode not found' };
      }
      endorsementPolicy = metadata.endorsementPolicy;
    }

    // Verify each endorsement
    const endorsingOrgs = new Set<string>();
    for (const endorsement of tx.endorsements) {
      // Verify endorsement signature
      const endorsementData = canonicalStringify({
        proposal: {
          txId: tx.txId,
          payload: tx.payload
        },
        rwSet: tx.rwSet,
        result: tx.result
      });

      const signatureValid = this.msp.verifySignature(
        endorsementData,
        endorsement.signature,
        endorsement.endorserId,
        'PEER'
      );

      if (!signatureValid.valid) {
        return { code: 'ENDORSEMENT_POLICY_FAILURE', message: signatureValid.error };
      }

      endorsingOrgs.add(endorsement.endorserOrgId);
    }

    // Check endorsement policy
    return this.checkEndorsementPolicy(endorsementPolicy, Array.from(endorsingOrgs));
  }

  /**
   * Check if endorsement policy is satisfied
   */
  private checkEndorsementPolicy(
    policy: EndorsementPolicy,
    endorsingOrgs: string[]
  ): { code: ValidationCode; message?: string } {
    switch (policy.type) {
      case 'ANY':
        if (policy.orgs.some(org => endorsingOrgs.includes(org))) {
          return { code: 'VALID' };
        }
        return { code: 'ENDORSEMENT_POLICY_FAILURE', message: 'ANY policy not satisfied' };

      case 'ALL':
        if (policy.orgs.every(org => endorsingOrgs.includes(org))) {
          return { code: 'VALID' };
        }
        return { code: 'ENDORSEMENT_POLICY_FAILURE', message: 'ALL policy not satisfied' };

      case 'MAJORITY':
        const requiredCount = Math.floor(policy.orgs.length / 2) + 1;
        const actualCount = policy.orgs.filter(org => endorsingOrgs.includes(org)).length;
        if (actualCount >= requiredCount) {
          return { code: 'VALID' };
        }
        return { code: 'ENDORSEMENT_POLICY_FAILURE', message: 'MAJORITY policy not satisfied' };

      default:
        return { code: 'BAD_PAYLOAD', message: 'Unknown endorsement policy type' };
    }
  }
}