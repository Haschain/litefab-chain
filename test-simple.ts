#!/usr/bin/env bun
/**
 * Simple integration test - 1 orderer, 1 peer
 */

import { readFileSync } from 'node:fs';
import { Peer } from './src/peer';
import { Orderer } from './src/orderer';
import { LitefabClient } from './src/client';
import { ConfigManager } from './src/config';

async function main() {
  console.log('=== Litefab-chain Simple Test ===\n');

  // Clean up old data
  const { rmSync, existsSync } = await import('node:fs');
  try { rmSync('./data', { recursive: true }); } catch {}

  // Generate config if needed
  if (!existsSync('./config/network-msp.json')) {
    console.log('Generating network config...');
    await ConfigManager.generateNetworkSetup();
  }

  // Load configs
  const peerConfig = ConfigManager.loadNodeConfig('./config/peer.json');
  const ordererConfig = ConfigManager.loadNodeConfig('./config/orderer.json');

  // Start peer first
  console.log('1. Starting peer...');
  const peer = new Peer(peerConfig);
  await peer.start();
  await new Promise(r => setTimeout(r, 500));

  // Start orderer
  console.log('2. Starting orderer...');
  const orderer = new Orderer(ordererConfig);
  await orderer.start();
  await new Promise(r => setTimeout(r, 500));

  // Create client
  console.log('3. Creating client...\n');
  const networkMsp = JSON.parse(readFileSync('./config/network-msp.json', 'utf-8'));
  const org1Client = networkMsp.orgs[0].identities.find((i: any) => i.id === 'Org1Client');
  const privateKey = readFileSync('./config/Org1Client_private.key', 'utf-8');

  const client = new LitefabClient(
    'Org1Client', 'Org1', org1Client.publicKey, privateKey,
    ['localhost:3001'], ['localhost:4000']
  );

  // Test 1: Deploy chaincode
  console.log('4. Deploying chaincode...');
  try {
    const txId = await client.deployChaincode('basic', { type: 'ANY', orgs: ['Org1'] }, []);
    console.log(`   ✓ Deploy submitted: ${txId.slice(0, 16)}...`);
  } catch (e: any) {
    console.log(`   ✗ Deploy failed: ${e.message}`);
  }

  // Wait for block (solo consensus has 2s timeout)
  console.log('   Waiting for block...');
  await new Promise(r => setTimeout(r, 3000));

  // Check state
  const supply1 = await client.queryChaincode('basic', 'totalSupply');
  console.log(`   Total supply: ${supply1 ?? 'null'}`);

  // Test 2: Mint tokens
  console.log('\n5. Minting 500 tokens to Alice...');
  try {
    const txId = await client.invokeChaincode('basic', 'mint', ['500', 'Alice']);
    console.log(`   ✓ Mint submitted: ${txId.slice(0, 16)}...`);
  } catch (e: any) {
    console.log(`   ✗ Mint failed: ${e.message}`);
  }

  await new Promise(r => setTimeout(r, 3000));
  const aliceBalance = await client.queryChaincode('basic', 'balance:Alice');
  const supply2 = await client.queryChaincode('basic', 'totalSupply');
  console.log(`   Alice balance: ${aliceBalance ?? 'null'}`);
  console.log(`   Total supply: ${supply2 ?? 'null'}`);

  // Test 3: Transfer
  console.log('\n6. Transferring 100 tokens from Alice to Bob...');
  try {
    const txId = await client.invokeChaincode('basic', 'transfer', ['Alice', 'Bob', '100']);
    console.log(`   ✓ Transfer submitted: ${txId.slice(0, 16)}...`);
  } catch (e: any) {
    console.log(`   ✗ Transfer failed: ${e.message}`);
  }

  await new Promise(r => setTimeout(r, 3000));
  const aliceFinal = await client.queryChaincode('basic', 'balance:Alice');
  const bobFinal = await client.queryChaincode('basic', 'balance:Bob');
  console.log(`   Alice final: ${aliceFinal ?? 'null'}`);
  console.log(`   Bob final: ${bobFinal ?? 'null'}`);

  // Cleanup
  console.log('\n7. Shutting down...');
  await orderer.stop();
  await peer.stop();

  console.log('\n=== Test Complete ===');
}

main().catch(console.error);
