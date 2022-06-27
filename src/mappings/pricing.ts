/* eslint-disable prefer-const */
import { Pair, Token, Bundle } from '../types/schema'
import { BigDecimal, Address, BigInt } from '@graphprotocol/graph-ts/index'
import { ZERO_BD, factoryContract, ADDRESS_ZERO, ONE_BD, UNTRACKED_PAIRS } from './helpers'

const WETH_ADDRESS = '0x0eb9036cbe0f052386f36170c6b07ef0a0e3f710'  // needs to be lower case
const USDC_WETH_PAIR = '0x9c597044bb020a4862d7d74052a8f545cdc1b8d1' // created block 760615
const USDT_WETH_PAIR = '0x8c243d7b04e0f8f78dc87c8c2297581310468129' // created block 760616

export function getEthPriceInUSD(): BigDecimal {
  // fetch eth prices for each stablecoin
  let usdcPair = Pair.load(USDC_WETH_PAIR) // usdc is token1
  let usdtPair = Pair.load(USDT_WETH_PAIR) // usdt is token1

  if (usdtPair !== null && usdcPair !== null) {
    let totalLiquidityETH = usdtPair.reserve0.plus(usdcPair.reserve0)
    let daiWeight = usdtPair.reserve0.div(totalLiquidityETH)
    let usdcWeight = usdcPair.reserve0.div(totalLiquidityETH)
    return usdtPair.token1Price.times(daiWeight).plus(usdcPair.token1Price.times(usdcWeight))
  } else {
    return ZERO_BD
  }
}

// token where amounts should contribute to tracked volume and liquidity
// todo: add new supported tokens here
// needs to be lower case addresses, not checksummed.
let WHITELIST: string[] = [
  '0x0eb9036cbe0f052386f36170c6b07ef0a0e3f710', // WBRISE
  '0x0e11dce06ef2fed6f78cef5144f970e1184b4298', // SPHYNX
  '0x71946a5c9da7c95ee804a9be561ec15a3f286a7d', // BPAD
  '0x41c5ae56681fb19334ecf7d914919805dae2ec8f', // BROGE
  '0x9b8535dd9281e48484725bc9eb6ed2f66cea2a36', // BRZILLA
  '0x1a8a039007186d7640c1d7cd7c2606e333d04e03', // BTXT
  '0xb860ecd8400600c13342a751408737235e177077', // ELTG
  '0x267ae4ba9ce5ef3c87629812596b0d89ecbd81dd', // EVO
  '0x6d347fdcb302a5879545e01ecee7a176db23dcda', // MAP
  '0x5b534a2df329195fd7e5c9aca1d9ffbda14a4963', // Miidas
  '0x2468dad471fa7e03d8029f057cc41742f017d53d', // MIR
  '0x6718e47e74497d1564ee76d832309144b83ef8e8', // NUMI
  '0x5d4685c2c75581c67b9d6292a065a767bc214681', // OMNIA
  '0x31226b28add9062c5064a9bd35ea155f323c6ca6', // PRDS
  '0x6660a7af57fae695d4a10d645088aba9fb547728', // RLUNA
  '0xd6447d2fa919811c41a064bdbdab1e281f8de9b2', // VEF
  '0xc89fcd3e1cf5a355fc41e160d18bac5f624610d4', // WMF
  '0xb361d5953e21cfde5cd62b89fdf40bc21903a6bb', // YOGO
  '0x11203a00a9134db8586381c4b2fca0816476b3fd', // YPC
  '0xb999ea90607a826a3e6e6646b404c3c7d11fa39d', // ICE
]

// minimum liquidity required to count towards tracked volume for pairs with small # of Lps
let MINIMUM_USD_THRESHOLD_NEW_PAIRS = BigDecimal.fromString('0')

// minimum liquidity for price to get tracked
let MINIMUM_LIQUIDITY_THRESHOLD_ETH = BigDecimal.fromString('0')

/**
 * Search through graph to find derived Eth per token.
 * @todo update to be derived ETH (add stablecoin estimates)
 **/
export function findEthPerToken(token: Token): BigDecimal {
  if (token.id == WETH_ADDRESS) {
    return ONE_BD
  }
  // loop through whitelist and check if paired with any
  for (let i = 0; i < WHITELIST.length; ++i) {
    let pairAddress = factoryContract.getPair(Address.fromString(token.id), Address.fromString(WHITELIST[i]))
    if (pairAddress.toHexString() != ADDRESS_ZERO) {
      let pair = Pair.load(pairAddress.toHexString())
      if (pair.token0 == token.id && pair.reserveETH.gt(MINIMUM_LIQUIDITY_THRESHOLD_ETH)) {
        let token1 = Token.load(pair.token1)
        return pair.token1Price.times(token1.derivedETH as BigDecimal) // return token1 per our token * Eth per token 1
      }
      if (pair.token1 == token.id && pair.reserveETH.gt(MINIMUM_LIQUIDITY_THRESHOLD_ETH)) {
        let token0 = Token.load(pair.token0)
        return pair.token0Price.times(token0.derivedETH as BigDecimal) // return token0 per our token * ETH per token 0
      }
    }
  }
  return ZERO_BD // nothing was found return 0
}

/**
 * Accepts tokens and amounts, return tracked amount based on token whitelist
 * If one token on whitelist, return amount in that token converted to USD.
 * If both are, return average of two amounts
 * If neither is, return 0
 */
export function getTrackedVolumeUSD(
  tokenAmount0: BigDecimal,
  token0: Token,
  tokenAmount1: BigDecimal,
  token1: Token,
  pair: Pair
): BigDecimal {
  let bundle = Bundle.load('1')
  let price0 = token0.derivedETH.times(bundle.ethPrice)
  let price1 = token1.derivedETH.times(bundle.ethPrice)

  // dont count tracked volume on these pairs - usually rebass tokens
  if (UNTRACKED_PAIRS.includes(pair.id)) {
    return ZERO_BD
  }

  // if less than 5 LPs, require high minimum reserve amount amount or return 0
  if (pair.liquidityProviderCount.lt(BigInt.fromI32(5))) {
    let reserve0USD = pair.reserve0.times(price0)
    let reserve1USD = pair.reserve1.times(price1)
    if (WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
      if (reserve0USD.plus(reserve1USD).lt(MINIMUM_USD_THRESHOLD_NEW_PAIRS)) {
        return ZERO_BD
      }
    }
    if (WHITELIST.includes(token0.id) && !WHITELIST.includes(token1.id)) {
      if (reserve0USD.times(BigDecimal.fromString('2')).lt(MINIMUM_USD_THRESHOLD_NEW_PAIRS)) {
        return ZERO_BD
      }
    }
    if (!WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
      if (reserve1USD.times(BigDecimal.fromString('2')).lt(MINIMUM_USD_THRESHOLD_NEW_PAIRS)) {
        return ZERO_BD
      }
    }
  }

  // both are whitelist tokens, take average of both amounts
  if (WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount0
      .times(price0)
      .plus(tokenAmount1.times(price1))
      .div(BigDecimal.fromString('2'))
  }

  // take full value of the whitelisted token amount
  if (WHITELIST.includes(token0.id) && !WHITELIST.includes(token1.id)) {
    return tokenAmount0.times(price0)
  }

  // take full value of the whitelisted token amount
  if (!WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount1.times(price1)
  }

  // neither token is on white list, tracked volume is 0
  return ZERO_BD
}

/**
 * Accepts tokens and amounts, return tracked amount based on token whitelist
 * If one token on whitelist, return amount in that token converted to USD * 2.
 * If both are, return sum of two amounts
 * If neither is, return 0
 */
export function getTrackedLiquidityUSD(
  tokenAmount0: BigDecimal,
  token0: Token,
  tokenAmount1: BigDecimal,
  token1: Token
): BigDecimal {
  let bundle = Bundle.load('1')
  let price0 = token0.derivedETH.times(bundle.ethPrice)
  let price1 = token1.derivedETH.times(bundle.ethPrice)

  // both are whitelist tokens, take average of both amounts
  if (WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount0.times(price0).plus(tokenAmount1.times(price1))
  }

  // take double value of the whitelisted token amount
  if (WHITELIST.includes(token0.id) && !WHITELIST.includes(token1.id)) {
    return tokenAmount0.times(price0).times(BigDecimal.fromString('2'))
  }

  // take double value of the whitelisted token amount
  if (!WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount1.times(price1).times(BigDecimal.fromString('2'))
  }

  // neither token is on white list, tracked volume is 0
  return ZERO_BD
}
