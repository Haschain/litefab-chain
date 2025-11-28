import type { 
  Proposal, 
  ProposalResponse, 
  TransactionEnvelope, 
  EndorsementPolicy,
  TxPayload
} from '../types';
import { generateTxId, canonicalStringify, sign } from '../crypto';

/**
 * Client for interacting with Litefab-chain network
 */
export class LitefabClient {
  private clientId: string;
  private clientOrgId: string;
  private clientPubKey: string;
  private clientPrivateKey: string;
  private peerAddresses: string[];
  private ordererAddresses: string[];

  constructor(
    clientId: string,
    clientOrgId: string,
    clientPubKey: string,
    clientPrivateKey: string,
    peerAddresses: string[],
    ordererAddresses: string[]
  ) {
    this.clientId = clientId;
    this.clientOrgId = clientOrgId;
    this.clientPubKey = clientPubKey;
    this.clientPrivateKey = clientPrivateKey;
    this.peerAddresses = peerAddresses;
    this.ordererAddresses = ordererAddresses;
  }

  /**
   * Deploy a new chaincode
   */
  async deployChaincode(
    chaincodeId: string,
    endorsementPolicy: EndorsementPolicy,
    args: string[] = []
  ): Promise<string> {
    const payload: TxPayload = {
      type: 'DEPLOY_CHAINCODE',
      chaincodeId,
      endorsementPolicy,
      args
    };

    return await this.submitTransaction(payload);
  }

  /**
   * Invoke a chaincode function
   */
  async invokeChaincode(
    chaincodeId: string,
    functionName: string,
    args: string[] = []
  ): Promise<string> {
    const payload: TxPayload = {
      type: 'INVOKE_CHAINCODE',
      chaincodeId,
      functionName,
      args
    };

    return await this.submitTransaction(payload);
  }

  /**
   * Query chaincode state (read-only operation)
   */
  async queryChaincode(
    chaincodeId: string,
    key: string
  ): Promise<string | null> {
    // Query any peer for the state
    for (const peerAddr of this.peerAddresses) {
      try {
        const response = await fetch(`http://${peerAddr}/query?key=${key}`);
        if (response.ok) {
          const result = await response.json() as { value: string | null };
          return result.value;
        }
      } catch (error) {
        console.error(`Error querying peer ${peerAddr}: ${error}`);
      }
    }

    throw new Error('Failed to query all peers');
  }

  /**
   * Submit a transaction through the full flow
   */
  private async submitTransaction(payload: TxPayload): Promise<string> {
    const txId = generateTxId();

    // Step 1: Create proposal
    const proposal = this.createProposal(txId, payload);

    // Step 2: Send proposal to endorsing peers
    const endorsements = await this.getEndorsements(proposal);

    // Step 3: Create transaction envelope
    const tx = this.createTransactionEnvelope(proposal, endorsements);

    // Step 4: Submit to ordering service
    await this.submitToOrderer(tx);

    return txId;
  }

  /**
   * Create a proposal
   */
  private createProposal(txId: string, payload: TxPayload): Proposal {
    // Sign the proposal
    const proposalData = canonicalStringify({
      txId,
      creatorId: this.clientId,
      creatorOrgId: this.clientOrgId,
      creatorPubKey: this.clientPubKey,
      payload
    });

    const signature = sign(proposalData, this.clientPrivateKey);

    const proposal: Proposal = {
      txId,
      creatorId: this.clientId,
      creatorOrgId: this.clientOrgId,
      creatorPubKey: this.clientPubKey,
      payload,
      signature
    };

    return proposal;
  }

  /**
   * Get endorsements from peers
   */
  private async getEndorsements(proposal: Proposal): Promise<any[]> {
    const endorsements: any[] = [];

    // For MVP, we'll send to all peers and collect endorsements
    // In a real implementation, this would be based on the endorsement policy
    for (const peerAddr of this.peerAddresses) {
      try {
        const response = await fetch(`http://${peerAddr}/proposal`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(proposal)
        });

        if (response.ok) {
          const proposalResponse: ProposalResponse = await response.json() as ProposalResponse;
          // Store the full response, not just the endorsement
          endorsements.push(proposalResponse);
        } else {
          const errorText = await response.text();
          console.error(`Peer ${peerAddr} rejected proposal: ${response.status} - ${errorText}`);
        }
      } catch (error) {
        console.error(`Error getting endorsement from peer ${peerAddr}: ${error}`);
      }
    }

    if (endorsements.length === 0) {
      throw new Error('Failed to get any endorsements');
    }

    return endorsements;
  }

  /**
   * Create a transaction envelope
   */
  private createTransactionEnvelope(proposal: Proposal, proposalResponses: ProposalResponse[]): TransactionEnvelope {
    // Get the first response for RWSet and result
    const firstResponse = proposalResponses[0];
    
    // Extract just the endorsements for the transaction
    const endorsements = proposalResponses.map(pr => pr.endorsement);

    const tx: TransactionEnvelope = {
      txId: proposal.txId,
      creatorId: proposal.creatorId,
      creatorOrgId: proposal.creatorOrgId,
      creatorPubKey: proposal.creatorPubKey,
      payload: proposal.payload,
      rwSet: firstResponse.rwSet,
      result: firstResponse.result,
      endorsements,
      clientSignature: '' // Will be filled below
    };

    // Sign the transaction
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

    tx.clientSignature = sign(txData, this.clientPrivateKey);

    return tx;
  }

  /**
   * Submit transaction to ordering service
   */
  private async submitToOrderer(tx: TransactionEnvelope): Promise<void> {
    // Try each orderer until one succeeds
    for (const ordererAddr of this.ordererAddresses) {
      try {
        const response = await fetch(`http://${ordererAddr}/submit`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(tx)
        });

        if (response.ok) {
          return; // Success
        }
      } catch (error) {
        console.error(`Error submitting to orderer ${ordererAddr}: ${error}`);
      }
    }

    throw new Error('Failed to submit to all orderers');
  }

  /**
   * Get transaction status
   */
  async getTransactionStatus(txId: string): Promise<any> {
    // This would query the ledger to find the transaction
    // For MVP, we'll just return a placeholder
    return {
      txId,
      status: 'unknown',
      message: 'Transaction status query not implemented in MVP'
    };
  }

  /**
   * Get block information
   */
  async getBlock(blockNumber: number): Promise<any> {
    // This would query the ledger for the block
    // For MVP, we'll just return a placeholder
    return {
      blockNumber,
      status: 'unknown',
      message: 'Block query not implemented in MVP'
    };
  }
}

/**
 * CLI interface for the client
 */
export class CLI {
  private client: LitefabClient;

  constructor(client: LitefabClient) {
    this.client = client;
  }

  /**
   * Deploy chaincode command
   */
  async deploy(chaincodeId: string, policy: string, args: string[] = []): Promise<void> {
    try {
      const endorsementPolicy = this.parseEndorsementPolicy(policy);
      const txId = await this.client.deployChaincode(chaincodeId, endorsementPolicy, args);
      console.log(`Chaincode ${chaincodeId} deployed successfully. Transaction ID: ${txId}`);
    } catch (error) {
      console.error(`Failed to deploy chaincode: ${error}`);
    }
  }

  /**
   * Invoke chaincode command
   */
  async invoke(chaincodeId: string, functionName: string, args: string[] = []): Promise<void> {
    try {
      const txId = await this.client.invokeChaincode(chaincodeId, functionName, args);
      console.log(`Chaincode invoked successfully. Transaction ID: ${txId}`);
    } catch (error) {
      console.error(`Failed to invoke chaincode: ${error}`);
    }
  }

  /**
   * Query chaincode command
   */
  async query(chaincodeId: string, key: string): Promise<void> {
    try {
      const value = await this.client.queryChaincode(chaincodeId, key);
      console.log(`Query result: ${value}`);
    } catch (error) {
      console.error(`Failed to query chaincode: ${error}`);
    }
  }

  /**
   * Parse endorsement policy string
   */
  private parseEndorsementPolicy(policy: string): EndorsementPolicy {
    // Simple parsing for MVP
    // Format: "ANY:Org1,Org2" or "ALL:Org1,Org2" or "MAJORITY:Org1,Org2,Org3"
    const parts = policy.split(':');
    if (parts.length !== 2) {
      throw new Error(`Invalid endorsement policy format: ${policy}`);
    }
    
    const type = parts[0];
    const orgsStr = parts[1];
    
    if (!type || !orgsStr) {
      throw new Error(`Invalid endorsement policy format: ${policy}`);
    }
    
    const orgs = orgsStr.split(',').map(org => org.trim());

    switch (type.toUpperCase()) {
      case 'ANY':
        return { type: 'ANY', orgs };
      case 'ALL':
        return { type: 'ALL', orgs };
      case 'MAJORITY':
        return { type: 'MAJORITY', orgs };
      default:
        throw new Error(`Unknown endorsement policy type: ${type}`);
    }
  }
}