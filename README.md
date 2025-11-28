# Litefab-chain

A minimal, Fabric-inspired permissioned blockchain implemented using Bun + TypeScript + LevelDB.

## Features

- **MSP** (Membership Service Provider) with identity management
- **Solo consensus** for simple single-node ordering
- **Endorsement-based transaction flow**
- **JS/TS chaincode** execution
- **Deterministic ledger + world state** on LevelDB

## Quick Start

### 1. Install Dependencies

```bash
bun install
```

### 2. Generate Network Configuration

```bash
bun run generate-config
```

This creates:
- `./config/network-msp.json` - Network MSP configuration
- `./config/orderer.json` - Orderer node config
- `./config/peer.json` - Peer node config
- `./config/*_private.key` - Private keys for identities

### 3. Run the Integration Test

```bash
bun run test-simple.ts
```

This starts 1 orderer + 1 peer and runs a full test:
- Deploy chaincode
- Mint tokens
- Transfer tokens
- Query balances

### 4. Manual Network Start (Optional)

Start the peer:
```bash
bun run start-peer ./config/peer.json
```

Start the orderer (in another terminal):
```bash
bun run start-orderer ./config/orderer.json
```

## Architecture

```
src/
├── types/          # TypeScript type definitions
├── crypto/         # Cryptographic utilities (sign, verify, hash)
├── msp/            # Membership Service Provider
├── storage/        # LevelDB storage for ledger and world state
├── chaincode/      # Chaincode execution engine
├── consensus/      # Consensus modules (Solo, Raft)
├── peer/           # Peer node implementation
├── orderer/        # Orderer node implementation
├── client/         # Client library and CLI
└── config/         # Configuration management

chaincodes/
└── basic/          # Example token chaincode
```

## Transaction Flow

1. **Client** creates a proposal and sends to peer(s)
2. **Peer** executes chaincode (simulation) and returns endorsement
3. **Client** collects endorsements and submits to orderer
4. **Orderer** orders transactions into blocks
5. **Orderer** broadcasts blocks to peers
6. **Peer** validates and commits blocks to ledger

## Chaincode Example

```typescript
// chaincodes/basic/index.ts
export const chaincode: Chaincode = {
  async init(ctx, args) {
    await ctx.putState('totalSupply', '0');
    return 'Initialized';
  },

  async invoke(ctx, fn, args) {
    switch (fn) {
      case 'mint':
        // Mint tokens logic
        break;
      case 'transfer':
        // Transfer tokens logic
        break;
    }
  }
};
```

## Test
```bash
$ bun test-simple.ts
=== Litefab-chain Simple Test ===

1. Starting peer...
Loaded chaincode: basic
Peer Org1Peer1 started on localhost:3001
2. Starting orderer...
Orderer orderer1 started on localhost:4000
3. Creating client...

4. Deploying chaincode...
   ✓ Deploy submitted: ffa4961baaa072b6...
   Waiting for block...
Committed block 0 with 1 transactions
Orderer orderer1 committed block 0
   Total supply: 0

5. Minting 500 tokens to Alice...
   ✓ Mint submitted: 5bf583dc232a5708...
Committed block 1 with 1 transactions
Orderer orderer1 committed block 1
   Alice balance: 500
   Total supply: 500

6. Transferring 100 tokens from Alice to Bob...
   ✓ Transfer submitted: fa27f8a7aae44f5e...
Committed block 2 with 1 transactions
Orderer orderer1 committed block 2
   Alice final: 400
   Bob final: 100

7. Shutting down...
Orderer orderer1 stopped
Peer Org1Peer1 stopped

=== Test Complete ===
```

## License

MIT
