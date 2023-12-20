import { PublicKey } from "@solana/web3.js";
import {
    PriceMath, TICK_ARRAY_SIZE, getAccountSize, AccountName, ParsableTickArray, WhirlpoolClient
} from "@orca-so/whirlpools-sdk";
import BN from "bn.js";
import Decimal from "decimal.js";

export type LiquidityDistributionDataPoint = {
  tickIndex: number;
  price: Decimal;
  liquidity: BN;
};

export type LiquidityDistribution = {
  currentTickIndex: number;
  currentPrice: Decimal;
  currentLiquidity: BN;
  datapoints: LiquidityDistributionDataPoint[];
};

export async function getLiquidityDistribution(client: WhirlpoolClient, whirlpoolPubkey: PublicKey): Promise<LiquidityDistribution> {
  const ctx = client.getContext();
  const whirlpool = await client.getPool(whirlpoolPubkey);

  const tokenA = whirlpool.getTokenAInfo();
  const tokenB = whirlpool.getTokenBInfo();
  const whirlpoolData = whirlpool.getData();
  const tickSpacing = whirlpoolData.tickSpacing;

  // get tickarrays
  const tickarrayAccounts = await ctx.connection.getProgramAccounts(ctx.program.programId, {
    commitment: "confirmed",
    encoding: "base64",
    filters: [
      { dataSize: getAccountSize(AccountName.TickArray) },
      { memcmp: { offset: 9956, bytes: whirlpoolPubkey.toBase58() } },
    ],
  });
  const tickarrays = tickarrayAccounts.map((a) => ParsableTickArray.parse(a.pubkey, a.account)!);

  // sort tickarrays by startTickIndex (asc)
  tickarrays.sort((a, b) => a.startTickIndex - b.startTickIndex);

  // sweep liquidity
  // background: https://yugure-sol.notion.site/How-TickArray-works-to-maintain-GlobalLiquidity-24ff587c6cd84cc4ac0c0615c4f7f4ae
  const datapoints: LiquidityDistributionDataPoint[] = [];
  let liquidity = new BN(0);
  for ( let ta=0; ta<tickarrays.length; ta++ ) {
    const tickarray = tickarrays[ta];

    for ( let i=0; i<TICK_ARRAY_SIZE; i++ ) {
      const tickIndex = tickarray.startTickIndex + i*tickSpacing;
      const price = PriceMath.tickIndexToPrice(tickIndex, tokenA.decimals, tokenB.decimals);

      // store if and only if liquidityNet is not zero
      if ( tickarray.ticks[i].liquidityNet.isZero() ) {
        continue;
      }

      // move right (add liquidityNet)
      liquidity = liquidity.add(tickarray.ticks[i].liquidityNet);
      datapoints.push({
        tickIndex,
        price,
        liquidity,
      });
    }
  }

  return {
    currentTickIndex: whirlpoolData.tickCurrentIndex,
    currentPrice: PriceMath.sqrtPriceX64ToPrice(whirlpoolData.sqrtPrice, tokenA.decimals, tokenB.decimals),
    currentLiquidity: whirlpoolData.liquidity,
    datapoints,
  };
}
