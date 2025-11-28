#!/usr/bin/env bun

import { Peer } from './peer';
import { Orderer } from './orderer';
import { LitefabClient, CLI } from './client';
import { ConfigManager } from './config';
import { readFileSync } from 'node:fs';

/**
 * Main CLI for Litefab-chain
 */
class LitefabCLI {
  static async main(): Promise<void> {
    const args = process.argv.slice(2);
    const command = args[0];

    switch (command) {
      case 'generate-config':
        await ConfigManager.generateNetworkSetup();
        break;

      case 'start-peer':
        await this.startPeer(args[1]);
        break;

      case 'start-orderer':
        await this.startOrderer(args[1]);
        break;

      case 'client':
        await this.runClient(args.slice(1));
        break;

      case 'help':
      default:
        this.showHelp();
        break;
    }
  }

  private static async startPeer(configPath?: string): Promise<void> {
    if (!configPath) {
      console.error('Please provide a config file path');
      process.exit(1);
    }

    try {
      const config = ConfigManager.loadNodeConfig(configPath);
      const validation = ConfigManager.validateNodeConfig(config);
      
      if (!validation.valid) {
        console.error('Invalid configuration:');
        validation.errors.forEach(error => console.error(`  - ${error}`));
        process.exit(1);
      }

      const peer = new Peer(config);
      await peer.start();

      // Handle graceful shutdown
      process.on('SIGINT', async () => {
        console.log('\nShutting down peer...');
        await peer.stop();
        process.exit(0);
      });

      // Keep the process running
      console.log('Peer is running. Press Ctrl+C to stop.');
    } catch (error) {
      console.error(`Failed to start peer: ${error}`);
      process.exit(1);
    }
  }

  private static async startOrderer(configPath?: string): Promise<void> {
    if (!configPath) {
      console.error('Please provide a config file path');
      process.exit(1);
    }

    try {
      const config = ConfigManager.loadNodeConfig(configPath);
      const validation = ConfigManager.validateNodeConfig(config);
      
      if (!validation.valid) {
        console.error('Invalid configuration:');
        validation.errors.forEach(error => console.error(`  - ${error}`));
        process.exit(1);
      }

      const orderer = new Orderer(config);
      await orderer.start();

      // Handle graceful shutdown
      process.on('SIGINT', async () => {
        console.log('\nShutting down orderer...');
        await orderer.stop();
        process.exit(0);
      });

      // Keep the process running
      console.log('Orderer is running. Press Ctrl+C to stop.');
    } catch (error) {
      console.error(`Failed to start orderer: ${error}`);
      process.exit(1);
    }
  }

  private static async runClient(args: string[]): Promise<void> {
    const command = args[0];
    const configPath = args[1];

    if (!configPath) {
      console.error('Please provide a client config file path');
      process.exit(1);
    }

    try {
      const clientConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
      
      const client = new LitefabClient(
        clientConfig.clientId,
        clientConfig.clientOrgId,
        clientConfig.clientPubKey,
        clientConfig.clientPrivateKey,
        clientConfig.peerAddresses,
        clientConfig.ordererAddresses
      );

      const cli = new CLI(client);

      switch (command) {
        case 'deploy':
          if (!args[2] || !args[3]) {
            console.error('Usage: client deploy <chaincode-id> <policy> [args...]');
            process.exit(1);
          }
          await cli.deploy(args[2], args[3], args.slice(4));
          break;

        case 'invoke':
          if (!args[2] || !args[3]) {
            console.error('Usage: client invoke <chaincode-id> <function> [args...]');
            process.exit(1);
          }
          await cli.invoke(args[2], args[3], args.slice(4));
          break;

        case 'query':
          if (!args[2] || !args[3]) {
            console.error('Usage: client query <chaincode-id> <key>');
            process.exit(1);
          }
          await cli.query(args[2], args[3]);
          break;

        default:
          console.error('Unknown client command:', command);
          console.error('Available commands: deploy, invoke, query');
          process.exit(1);
      }
    } catch (error) {
      console.error(`Client operation failed: ${error}`);
      process.exit(1);
    }
  }

  private static showHelp(): void {
    console.log(`
Litefab-chain - Minimal Fabric-like Blockchain

Usage:
  bun run index.ts <command> [options]

Commands:
  generate-config                    Generate sample network configuration
  start-peer <config-file>          Start a peer node
  start-orderer <config-file>        Start an orderer node
  client <sub-command> <config>     Run client operations

Client sub-commands:
  deploy <chaincode-id> <policy> [args...]    Deploy chaincode
  invoke <chaincode-id> <function> [args...]  Invoke chaincode function
  query <chaincode-id> <key>                  Query chaincode state

Examples:
  bun run index.ts generate-config
  bun run index.ts start-peer ./config/peer1.json
  bun run index.ts start-orderer ./config/orderer1.json
  bun run index.ts client deploy basic "ALL:Org1,Org2" ./client-config.json
  bun run index.ts client invoke basic mint 100 ./client-config.json
  bun run index.ts client query basic balance ./client-config.json
`);
  }
}

// Run the CLI if this file is executed directly
if (import.meta.main) {
  LitefabCLI.main().catch(console.error);
}

export { Peer, Orderer, LitefabClient, CLI, ConfigManager };