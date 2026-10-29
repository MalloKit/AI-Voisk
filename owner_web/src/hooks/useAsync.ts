import { useEffect, useState } from "react";

export function useAsync<T>(load: (signal: AbortSignal) => Promise<T>) {
  const [data, setData] = useState<T>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setError(false);
    load(abort.signal).then(
      (next) => {
        if (!abort.signal.aborted) {
          setData(next);
          setLoading(false);
        }
      },
      () => {
        if (!abort.signal.aborted) {
          setError(true);
          setLoading(false);
        }
      },
    );
    return () => abort.abort();
  }, [load, version]);
  return {
    data,
    setData,
    loading,
    error,
    reload: () => setVersion((v) => v + 1),
  };
}
