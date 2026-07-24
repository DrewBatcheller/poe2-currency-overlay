// [EE2-VENDOR TRIMMED] Replaces renderer/src/web/background/TradeData.ts.
//
// Upstream this is a @vueuse `createGlobalState` store that fetches the official
// trade2 reference data (www.pathofexile.com/api/trade2/data/{items,stats}) through
// the Electron `Host.proxy` IPC bridge and exposes it as Vue refs. The vendored
// data module (assets/data/index.ts -> loadTradeData) consumes only this shape:
//   useTradeData() -> { error, expressInterest, tradeItemData, tradeStatData,
//                       tradeStatDataSet, load }
// where the data members are `{ value }` ref-likes.
//
// REMOVED: `vue` (readonly/shallowRef), `@vueuse/core` (createGlobalState),
// Electron IPC (`Host.proxy`), the network loaders (loadItemData/loadStatData),
// the retry setInterval, and the update/interest throttling.
//
// This pure version is a plain singleton holding empty collections. `load()` is a
// no-op by default: with no trade2 reference data, the data module's TRADE_ITEM_BY_REF
// / TRADE_STAT_BY_STAT_ID / TRADE_STAT_BY_MATCH_STR helpers simply return
// undefined/false (their documented "not found" path) — parsing and query building
// still work, just without trade-tag/augment cross-validation.
//
// The host app can populate the data by calling setTradeData() (e.g. after fetching
// the two trade2 endpoints itself) so those helpers become fully functional.

interface RefLike<T> {
  value: T;
}

export interface ItemQuery {
  group: string;
  type: string;
  name?: string;
}

const _state = {
  isLoading: { value: false } as RefLike<boolean>,
  error: { value: null } as RefLike<string | null>,
  itemData: { value: new Set<string>() } as RefLike<Set<string>>,
  statData: { value: new Map<string, { [type: string]: string[] }>() } as RefLike<
    Map<string, { [type: string]: string[] }>
  >,
  statDataSet: { value: new Set<string>() } as RefLike<Set<string>>,
};

/**
 * Host injector: supply pre-fetched trade2 reference data.
 * @param itemData    set of trade item nameplates (REF names)
 * @param statData    map of matcher-string -> { modType: statId[] }
 * @param statDataSet set of all trade stat ids
 */
export function setTradeData(
  itemData: Set<string>,
  statData: Map<string, { [type: string]: string[] }>,
  statDataSet: Set<string>,
): void {
  _state.itemData.value = itemData;
  _state.statData.value = statData;
  _state.statDataSet.value = statDataSet;
}

export function useTradeData() {
  return {
    isLoading: _state.isLoading,
    error: _state.error,
    expressInterest() {
      /* no-op: nothing throttles loads in the pure subtree */
    },
    tradeItemData: _state.itemData,
    tradeStatData: _state.statData,
    tradeStatDataSet: _state.statDataSet,
    async load(_force = false): Promise<{ foundItems: number; foundStats: number } | undefined> {
      // no-op by default; host may pre-populate via setTradeData()
      return { foundItems: _state.itemData.value.size, foundStats: _state.statDataSet.value.size };
    },
  };
}
