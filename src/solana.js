const { Connection, PublicKey } = require('@solana/web3.js');

function isValidSolanaAddress(address) {
  // fast regex (base58) + PublicKey constructor as final check
  const base58Regex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  if (!base58Regex.test(address)) return false;
  try {
    // eslint-disable-next-line no-new
    new PublicKey(address);
    return true;
  } catch {
    return false;
  }
}

function isValidSolanaTxSig(sig) {
  const base58Regex = /^[1-9A-HJ-NP-Za-km-z]{87,88}$/;
  return base58Regex.test(sig);
}

function createConnection(rpcUrl) {
  return new Connection(rpcUrl, {
    commitment: 'confirmed',
    confirmTransactionInitialTimeout: 45_000,
  });
}

async function getTokenBalanceByOwner({ connection, ownerAddress, mintAddress }) {
  const owner = new PublicKey(ownerAddress);
  const mint = new PublicKey(mintAddress);

  const res = await connection.getParsedTokenAccountsByOwner(owner, { mint });
  let sum = 0;
  for (const item of res.value) {
    const uiAmount = item.account.data.parsed.info.tokenAmount.uiAmount;
    if (typeof uiAmount === 'number') sum += uiAmount;
  }
  return sum;
}

/**
 * Verify a buy proof using a transaction signature.
 * We treat it as a "buy" if:
 *   - netGgrdDelta > 0 for the given owner
 * and optionally
 *   - netUsdcDelta < 0 (spent) for the given owner
 *
 * Returns: { ok, netBuyUsdc, netBuyGgrd, slot }
 */
async function verifyBuyTx({ connection, txsig, ownerAddress, ggrdMint, usdcMint }) {
  const tx = await connection.getParsedTransaction(txsig, {
    maxSupportedTransactionVersion: 0,
    commitment: 'confirmed',
  });
  if (!tx) return { ok: false, reason: 'tx_not_found' };
  if (!tx.meta || tx.meta.err) return { ok: false, reason: 'tx_failed' };

  const pre = tx.meta.preTokenBalances || [];
  const post = tx.meta.postTokenBalances || [];

  // Normalize balances by (owner,mint)
  function keyOf(b) {
    return `${b.owner || ''}::${b.mint}`;
  }

  const preMap = new Map();
  for (const b of pre) preMap.set(keyOf(b), b);
  const postMap = new Map();
  for (const b of post) postMap.set(keyOf(b), b);

  const owner = ownerAddress;

  function getUiAmount(balance) {
    if (!balance) return 0;
    const ui = balance.uiTokenAmount?.uiAmount;
    if (typeof ui === 'number') return ui;
    // uiAmount can be null; fallback to string
    const s = balance.uiTokenAmount?.uiAmountString;
    if (!s) return 0;
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  }

  let netGgrd = 0;
  let netUsdc = 0;

  // iterate over union of keys for this owner
  const keys = new Set([...preMap.keys(), ...postMap.keys()]);
  for (const k of keys) {
    const [kOwner, mint] = k.split('::');
    if (kOwner !== owner) continue;

    const before = getUiAmount(preMap.get(k));
    const after = getUiAmount(postMap.get(k));
    const delta = after - before;

    if (mint === ggrdMint) netGgrd += delta;
    if (mint === usdcMint) netUsdc += delta;
  }

  // if owner fields are missing (rare), fall back to heuristic: any positive GGRD delta
  // (still requires caller to also pass holding threshold).
  if (netGgrd === 0) {
    for (const b of post) {
      if (b.mint !== ggrdMint) continue;
      const before = getUiAmount(pre.find(x => x.accountIndex === b.accountIndex));
      const after = getUiAmount(b);
      const delta = after - before;
      if (delta > 0) netGgrd += delta;
    }
  }

  const ok = netGgrd > 0;
  return {
    ok,
    netBuyGgrd: netGgrd,
    netBuyUsdc: netUsdc, // negative means spent
    slot: tx.slot,
  };
}

module.exports = {
  isValidSolanaAddress,
  isValidSolanaTxSig,
  createConnection,
  getTokenBalanceByOwner,
  verifyBuyTx,
};
