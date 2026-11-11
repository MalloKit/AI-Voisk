import { useEffect, useRef, useState } from "react";

type Address = { zonecode: string; address: string };
type Postcode = new (options: { oncomplete(data: Address): void; width: string; height: string }) => {
  embed(element: HTMLElement): void;
};
type PostcodeWindow = Window & { daum?: { Postcode?: Postcode } };
let loading: Promise<Postcode> | undefined;

function loadPostcode(): Promise<Postcode> {
  const sdk = (window as PostcodeWindow).daum?.Postcode;
  if (sdk) return Promise.resolve(sdk);
  if (!loading) {
    loading = new Promise<Postcode>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js";
      script.async = true;
      const finish = () => {
        window.clearTimeout(timer);
        script.onload = script.onerror = null;
        const loaded = (window as PostcodeWindow).daum?.Postcode;
        if (loaded) resolve(loaded);
        else {
          script.remove();
          reject(new Error("Postcode SDK unavailable"));
        }
      };
      const timer = window.setTimeout(finish, 10000);
      script.onload = script.onerror = finish;
      document.head.appendChild(script);
    }).finally(() => { loading = undefined; });
  }
  return loading;
}

export function PostcodeSearch({ onSelect, onClose }: {
  onSelect(data: Address): void;
  onClose(): void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onSelect });
  callbacks.current.onSelect = onSelect;
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    const target = container.current!;
    target.parentElement?.scrollIntoView?.({ block: "nearest" });
    let active = true;
    loadPostcode().then((Postcode) => {
      if (!active) return;
      new Postcode({
        width: "100%",
        height: "100%",
        oncomplete(data) {
          if (!active) return;
          if (typeof data.zonecode !== "string" || !/^[0-9]{5}$/.test(data.zonecode)
              || typeof data.address !== "string" || !data.address.trim()
              || Array.from(data.address).length > 200) {
            setStatus("error");
            return;
          }
          callbacks.current.onSelect(data);
        },
      }).embed(target);
      setStatus("ready");
    }).catch(() => { if (active) setStatus("error"); });
    return () => {
      active = false;
      target.replaceChildren();
    };
  }, []);

  return <section aria-label="카카오 주소 검색">
    <div className="store-form-actions">
      <button type="button" onClick={onClose}>주소 검색 닫기</button>
    </div>
    {status === "loading" && <p role="status">주소 검색을 불러오는 중…</p>}
    {status === "error" && <p role="alert">주소 검색을 사용할 수 없습니다. 우편번호와 주소를 직접 입력해 주세요.</p>}
    <div ref={container} hidden={status !== "ready"} style={{ height: 360 }} />
  </section>;
}
