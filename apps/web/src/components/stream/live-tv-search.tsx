"use client";

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

interface LiveTvSearchValue {
  query: string;
  setQuery: (query: string) => void;
}

const LiveTvSearchContext = createContext<LiveTvSearchValue | null>(null);

/** Shares the header search with the Live TV channel browser. */
export function LiveTvSearchProvider({ children }: { children: ReactNode }) {
  const [query, setQuery] = useState("");
  const value = useMemo(() => ({ query, setQuery }), [query]);
  return (
    <LiveTvSearchContext.Provider value={value}>
      {children}
    </LiveTvSearchContext.Provider>
  );
}

export function useLiveTvSearch() {
  return useContext(LiveTvSearchContext);
}
