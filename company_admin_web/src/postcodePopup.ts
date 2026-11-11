type Postcode = new (options: {
  width: string;
  height: string;
  oncomplete(data: { zonecode: string; address: string }): void;
}) => { embed(element: HTMLElement): void };
type PostcodeWindow = Window & { kakao?: { Postcode?: Postcode } };

const status = document.getElementById("postcode-status")!;
const target = document.getElementById("postcode-search")!;

function loadSearch(opener: Window) {
  const origin = window.location.origin;
  const script = document.createElement("script");
  script.src = "https://t1.kakaocdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js";
  script.async = true;

  function clearLoadHandlers() {
    window.clearTimeout(timeout);
    script.onload = script.onerror = null;
  }

  function fail() {
    clearLoadHandlers();
    script.remove();
    status.textContent = "주소 검색을 불러오지 못했습니다.";
    opener.postMessage({ type: "voisk:postcode-error" }, origin);
  }

  const timeout = window.setTimeout(fail, 10000);
  script.onerror = fail;
  script.onload = () => {
    const Postcode = (window as PostcodeWindow).kakao?.Postcode;
    if (!Postcode) {
      fail();
      return;
    }
    try {
      new Postcode({
        width: "100%",
        height: "100%",
        oncomplete({ zonecode, address }) {
          opener.postMessage({ type: "voisk:postcode-selected", zonecode, address }, origin);
        },
      }).embed(target);
      clearLoadHandlers();
      status.hidden = true;
      opener.postMessage({ type: "voisk:postcode-ready" }, origin);
    } catch {
      fail();
    }
  };
  document.head.appendChild(script);
}

const opener: Window | null = window.opener;
if (opener && !opener.closed) loadSearch(opener);
else status.textContent = "매장 입력 화면에서 주소 검색을 열어 주세요.";

export {};
