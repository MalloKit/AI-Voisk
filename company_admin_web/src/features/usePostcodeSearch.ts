import { useEffect, useRef, useState } from "react";

type Address = { zonecode: string; address: string };
const loadError = "주소 검색을 불러오지 못했습니다. 우편번호와 주소를 직접 입력해 주세요.";

export function usePostcodeSearch(onSelect: (data: Address) => void) {
  const addressButton = useRef<HTMLButtonElement>(null);
  const search = useRef<{ popup: Window; dispose(): void } | null>(null);
  const [searchingAddress, setSearchingAddress] = useState(false);
  const [addressError, setAddressError] = useState("");

  useEffect(() => () => search.current?.dispose(), []);

  function openAddressSearch() {
    if (search.current) {
      search.current.popup.focus();
      return;
    }
    setAddressError("");
    const url = new URL(`${import.meta.env.BASE_URL}postcode-popup.html`, window.location.href);
    const popup = window.open(url, "_blank", "popup,width=520,height=580,resizable=yes,scrollbars=yes");
    if (!popup) {
      setAddressError("주소 검색 팝업이 차단됐습니다. 팝업을 허용하거나 우편번호와 주소를 직접 입력해 주세요.");
      return;
    }

    const dispose = () => {
      search.current = null;
      window.clearInterval(closeCheck);
      window.clearTimeout(loadTimeout);
      window.removeEventListener("message", receive);
      if (!popup.closed) popup.close();
    };

    function finish(error = "") {
      dispose();
      setSearchingAddress(false);
      setAddressError(error);
      addressButton.current?.focus();
    }

    function receive(event: MessageEvent) {
      if (event.origin !== url.origin || event.source !== popup) return;
      const data = event.data;
      if (data?.type === "voisk:postcode-ready") {
        window.clearTimeout(loadTimeout);
      } else if (data?.type === "voisk:postcode-error") {
        finish(loadError);
      } else if (data?.type === "voisk:postcode-selected") {
        const { zonecode, address } = data;
        if (typeof zonecode !== "string" || !/^[0-9]{5}$/.test(zonecode)
            || typeof address !== "string" || !address.trim()
            || Array.from(address).length > 200) {
          finish("선택한 주소를 적용할 수 없습니다. 우편번호와 주소를 직접 입력해 주세요.");
          return;
        }
        onSelect({ zonecode, address });
        finish();
      }
    }

    const closeCheck = window.setInterval(() => {
      if (popup.closed) finish("주소 검색 창이 닫혔습니다. 다시 검색하거나 주소를 직접 입력해 주세요.");
    }, 250);
    const loadTimeout = window.setTimeout(() => finish(loadError), 15000);
    search.current = { popup, dispose };
    window.addEventListener("message", receive);
    setSearchingAddress(true);
  }

  return { addressButton, searchingAddress, addressError, openAddressSearch };
}
