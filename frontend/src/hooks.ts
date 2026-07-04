// Small data hooks shared by the reader views.

import { useEffect, useState } from "react";
import { api, type DocResponse, type Level } from "./api";

// Fetch a whole document at a given level (from cache — instant, §3.3).
export function useDoc(docId: string, level: Level): DocResponse | null {
  const [doc, setDoc] = useState<DocResponse | null>(null);
  useEffect(() => {
    let alive = true;
    api.doc(docId, level).then((d) => {
      if (alive) setDoc(d);
    });
    return () => {
      alive = false;
    };
  }, [docId, level]);
  return doc;
}
