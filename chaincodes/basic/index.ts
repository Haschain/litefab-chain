import type { Chaincode, ChaincodeContext } from '../../src/types';

/**
 * Mint new tokens (only Org1 can mint for demo)
 */
async function mint(ctx: ChaincodeContext, args: string[]): Promise<string> {
  const [amount, recipient] = args;
  
  if (!amount || !recipient) {
    throw new Error('Mint requires amount and recipient');
  }

  // Check if caller is from Org1 (simplified authorization)
  if (!ctx.clientOrgId.includes('Org1')) {
    throw new Error('Only Org1 can mint tokens');
  }

  const amountNum = parseInt(amount);
  if (isNaN(amountNum) || amountNum <= 0) {
    throw new Error('Invalid amount');
  }

  // Update total supply
  const currentSupplyStr = await ctx.getState('totalSupply') || '0';
  const currentSupply = parseInt(currentSupplyStr);
  const newSupply = currentSupply + amountNum;
  await ctx.putState('totalSupply', newSupply.toString());

  // Update recipient balance
  const balanceKey = `balance:${recipient}`;
  const currentBalanceStr = await ctx.getState(balanceKey) || '0';
  const currentBalance = parseInt(currentBalanceStr);
  const newBalance = currentBalance + amountNum;
  await ctx.putState(balanceKey, newBalance.toString());

  return `Minted ${amountNum} tokens to ${recipient}`;
}

/**
 * Transfer tokens from one account to another
 */
async function transfer(ctx: ChaincodeContext, args: string[]): Promise<string> {
  const [from, to, amount] = args;
  
  if (!from || !to || !amount) {
    throw new Error('Transfer requires from, to, and amount');
  }

  const amountNum = parseInt(amount);
  if (isNaN(amountNum) || amountNum <= 0) {
    throw new Error('Invalid amount');
  }

  // Check from balance
  const fromBalanceKey = `balance:${from}`;
  const fromBalanceStr = await ctx.getState(fromBalanceKey) || '0';
  const fromBalance = parseInt(fromBalanceStr);
  
  if (fromBalance < amountNum) {
    throw new Error('Insufficient balance');
  }

  // Update from balance
  await ctx.putState(fromBalanceKey, (fromBalance - amountNum).toString());

  // Update to balance
  const toBalanceKey = `balance:${to}`;
  const toBalanceStr = await ctx.getState(toBalanceKey) || '0';
  const toBalance = parseInt(toBalanceStr);
  await ctx.putState(toBalanceKey, (toBalance + amountNum).toString());

  return `Transferred ${amountNum} tokens from ${from} to ${to}`;
}

/**
 * Get balance of an account
 */
async function balanceOf(ctx: ChaincodeContext, args: string[]): Promise<string> {
  const [account] = args;
  
  if (!account) {
    throw new Error('balanceOf requires account');
  }

  const balanceKey = `balance:${account}`;
  const balanceStr = await ctx.getState(balanceKey) || '0';
  return balanceStr;
}

/**
 * Get total supply
 */
async function totalSupply(ctx: ChaincodeContext): Promise<string> {
  const supplyStr = await ctx.getState('totalSupply') || '0';
  return supplyStr;
}

/**
 * Basic chaincode for demonstration
 * Implements a simple token system with mint, transfer, and balance functions
 */
export const chaincode: Chaincode = {
  /**
   * Initialize chaincode
   */
  async init(ctx: ChaincodeContext, args: string[]): Promise<string> {
    // Initialize with total supply if provided
    if (args.length > 0) {
      const totalSupply = args[0];
      if (totalSupply) {
        await ctx.putState('totalSupply', totalSupply);
        return `Initialized with total supply: ${totalSupply}`;
      }
    }
    
    await ctx.putState('totalSupply', '0');
    return 'Initialized with zero supply';
  },

  /**
   * Invoke chaincode functions
   */
  async invoke(ctx: ChaincodeContext, fn: string, args: string[]): Promise<string> {
    switch (fn) {
      case 'mint':
        return await mint(ctx, args);
      
      case 'transfer':
        return await transfer(ctx, args);
      
      case 'balanceOf':
        return await balanceOf(ctx, args);
      
      case 'totalSupply':
        return await totalSupply(ctx);
      
      default:
        throw new Error(`Unknown function: ${fn}`);
    }
  }
};