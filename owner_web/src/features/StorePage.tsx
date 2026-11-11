import { Info, MonitorSmartphone } from "lucide-react";
import type { StoreProfile } from "../data/models";
import { formatBusinessNo } from "../data/orderSelectors";
import { Card, Field, Heading } from "../components/ui";

// 매장 정보는 회사 관리자가 관리하므로 점주 화면에서는 보기만 한다.
export function StorePage({ profile }: { profile: StoreProfile }) {
  const { store } = profile;
  return (
    <>
      <Heading title="매장 정보">
        회사 관리자가 등록한 매장 기본 정보입니다.
      </Heading>
      <Card>
        <dl className="detail-grid">
          <Field label="매장 이름">{store.name}</Field>
          <Field label="업종">{store.storeType}</Field>
          <Field label="매장 코드">{store.storeCode}</Field>
          <Field label="대표자">{store.representative}</Field>
          <Field label="전화번호">{store.phone}</Field>
          <Field label="사업자등록번호">
            {formatBusinessNo(store.businessNo)}
          </Field>
          <Field label="주소">
            {[store.address1, store.address2].filter(Boolean).join(" ")}
          </Field>
        </dl>
      </Card>
      <p className="info-box">
        <Info size={18} aria-hidden="true" />
        정보 변경은 회사 관리자에게 요청해 주세요.
      </p>
      <p className="info-box">
        <MonitorSmartphone size={18} aria-hidden="true" />
        <span>
          키오스크는 매장 번호(store_id) <strong>{store.id}</strong>로 이 매장의
          메뉴를 불러옵니다. 키오스크 앱의 STORE_ID 설정이 이 번호와 같아야
          합니다.
        </span>
      </p>
    </>
  );
}
