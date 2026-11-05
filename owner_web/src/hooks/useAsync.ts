import { useEffect, useState } from "react";

export function useAsync<T>(load: (signal: AbortSignal) => Promise<T>) {
  const [data, setData] = useState<T>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  // 화면이 403·503 문구를 구분하도록 실패 원인도 함께 둔다.
  const [failure, setFailure] = useState<unknown>();
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setError(false);
    setFailure(undefined);
    load(abort.signal).then(
      (next) => {
        if (!abort.signal.aborted) {
          setData(next);
          setLoading(false);
        }
      },
      (reason: unknown) => {
        if (!abort.signal.aborted) {
          setError(true);
          setFailure(reason);
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
    failure,
    reload: () => setVersion((v) => v + 1),
  };
}
