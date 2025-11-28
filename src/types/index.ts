// Core types for Litefab-chain

export type TxType = 'DEPLOY_CHAINCODE' | 'INVOKE_CHAINCODE';

export interface TxPayload {
  type: TxType;
  chaincodeId: string;
  functionName?: string;
  args?: string[];
  endorsementPolicy?: EndorsementPolicy;
}

export interface ReadVersion {
  key: string;
  version: { blockNum: number; txNum: number } | null;
}

export interface WriteEntry {
  key: string;
  value: string | null;
}

export interface RWSet {
  reads: ReadVersion[];
  writes: WriteEntry[];
}

export interface Endorsement {
  endorserId: string;
  endorserOrgId: string;
  signature: string;
}

export interface TransactionEnvelope {
  txId: string;
  creatorId: string;
  creatorOrgId: string;
  creatorPubKey: string;
  payload: TxPayload;
  rwSet: RWSet;
  result: string | null;
  endorsements: Endorsement[];
  clientSignature: string;
}

export type EndorsementPolicy =
  | { type: 'ANY'; orgs: string[] }
  | { type: 'ALL'; orgs: string[] }
  | { type: 'MAJORITY'; orgs: string[] };

export interface BlockHeader {
  number: number;
  previousHash: string;
  dataHash: string;
}

export type ValidationCode =
  | 'VALID'
  | 'ENDORSEMENT_POLICY_FAILURE'
  | 'MVCC_READ_CONFLICT'
  | 'BAD_PAYLOAD'
  | 'MSP_VALIDATION_FAILED';

export interface TxValidationInfo {
  txId: string;
  code: ValidationCode;
  message?: string;
}

export interface BlockMetadata {
  timestamp: string;
  ordererId: string;
  ordererSignature: string;
  validationInfo?: TxValidationInfo[];
}

export interface Block {
  header: BlockHeader;
  transactions: TransactionEnvelope[];
  metadata: BlockMetadata;
}

export interface Identity {
  id: string;
  orgId: string;
  role: 'ADMIN' | 'CLIENT' | 'PEER' | 'ORDERER';
  publicKey: string;
}

export interface OrgMSP {
  orgId: string;
  rootPublicKeys: string[];
  identities: Identity[];
}

export interface NetworkMSPConfig {
  orgs: OrgMSP[];
}

export interface NodeConfig {
  nodeId: string;
  role: 'peer' | 'orderer' | 'peer+orderer';
  orgId?: string;
  listenAddr: string;
  ordererCluster: { nodes: string[]; selfId?: string };
  peers: string[];
  dbPath: string;
  chaincodeRoot: string;
  mspConfigPath: string;
  privateKeyPath?: string;
  consensus: 'solo' | 'raft' | 'pbft';
}

export interface ChaincodeContext {
  txId: string;
  clientId: string;
  clientOrgId: string;
  getState(key: string): Promise<string | null>;
  putState(key: string, value: string): Promise<void>;
  delState(key: string): Promise<void>;
}

export interface Chaincode {
  init?(ctx: ChaincodeContext, args: string[]): Promise<string | void>;
  invoke(ctx: ChaincodeContext, fn: string, args: string[]): Promise<string | void>;
}

export interface ConsensusModule {
  submitTx(tx: TransactionEnvelope): Promise<void>;
  onBlockCommitted(cb: (block: Block) => void): void;
}

export interface Proposal {
  txId: string;
  creatorId: string;
  creatorOrgId: string;
  creatorPubKey: string;
  payload: TxPayload;
  signature: string;
}

export interface ProposalResponse {
  proposal: Proposal;
  rwSet: RWSet;
  result: string | null;
  endorsement: Endorsement;
}