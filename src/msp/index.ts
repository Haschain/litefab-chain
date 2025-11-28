import { readFileSync } from 'node:fs';
import type { NetworkMSPConfig, Identity, OrgMSP } from '../types';
import { verify } from '../crypto';

export class MSP {
  private config: NetworkMSPConfig;
  private identityMap: Map<string, Identity> = new Map();
  private orgMap: Map<string, OrgMSP> = new Map();

  constructor(configPath: string) {
    const configData = readFileSync(configPath, 'utf-8');
    this.config = JSON.parse(configData) as NetworkMSPConfig;
    this.initialize();
  }

  private initialize(): void {
    // Build identity map for quick lookup
    for (const org of this.config.orgs) {
      this.orgMap.set(org.orgId, org);
      for (const identity of org.identities) {
        this.identityMap.set(identity.id, identity);
      }
    }
  }

  /**
   * Get identity by ID
   */
  getIdentity(id: string): Identity | null {
    return this.identityMap.get(id) || null;
  }

  /**
   * Get organization by ID
   */
  getOrganization(orgId: string): OrgMSP | null {
    return this.orgMap.get(orgId) || null;
  }

  /**
   * Check if an identity is valid for a given organization
   */
  isValidIdentity(identity: Identity, orgId: string): boolean {
    const org = this.getOrganization(orgId);
    if (!org) return false;

    // Check if identity belongs to the organization
    if (identity.orgId !== orgId) return false;

    // Check if identity exists in the organization
    const foundIdentity = this.identityMap.get(identity.id);
    if (!foundIdentity) return false;

    // Check if public keys match
    return foundIdentity.publicKey === identity.publicKey;
  }

  /**
   * Verify a signature and check if the signer is valid
   */
  verifySignature(
    data: string,
    signature: string,
    signerId: string,
    expectedRole?: string
  ): { valid: boolean; identity?: Identity; error?: string } {
    const identity = this.getIdentity(signerId);
    if (!identity) {
      return { valid: false, error: `Identity ${signerId} not found` };
    }

    if (expectedRole && identity.role !== expectedRole) {
      return { valid: false, error: `Identity ${signerId} has role ${identity.role}, expected ${expectedRole}` };
    }

    const signatureValid = verify(data, signature, identity.publicKey);
    if (!signatureValid) {
      return { valid: false, error: `Invalid signature for ${signerId}` };
    }

    return { valid: true, identity };
  }

  /**
   * Check if an identity has admin role
   */
  isAdmin(identityId: string): boolean {
    const identity = this.getIdentity(identityId);
    return identity?.role === 'ADMIN';
  }

  /**
   * Check if an identity has client role
   */
  isClient(identityId: string): boolean {
    const identity = this.getIdentity(identityId);
    return identity?.role === 'CLIENT';
  }

  /**
   * Check if an identity has peer role
   */
  isPeer(identityId: string): boolean {
    const identity = this.getIdentity(identityId);
    return identity?.role === 'PEER';
  }

  /**
   * Check if an identity has orderer role
   */
  isOrderer(identityId: string): boolean {
    const identity = this.getIdentity(identityId);
    return identity?.role === 'ORDERER';
  }

  /**
   * Get all identities for an organization
   */
  getIdentitiesForOrg(orgId: string): Identity[] {
    const org = this.getOrganization(orgId);
    return org ? org.identities : [];
  }

  /**
   * Get all organizations
   */
  getAllOrganizations(): OrgMSP[] {
    return Array.from(this.orgMap.values());
  }

  /**
   * Check if an organization exists
   */
  hasOrganization(orgId: string): boolean {
    return this.orgMap.has(orgId);
  }
}