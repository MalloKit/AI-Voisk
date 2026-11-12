// 개발용 Mock 계정. MockOwnerAuthRepository에서만 쓰고, 서버 API 모드에서는 로그인되지 않는다.
// 실제 운영 계정·비밀번호가 아니며 운영 DB에 이 값을 넣지 않는다.
export interface MockOwnerAccount {
  ownerId: number;
  loginId: string;
  password: string;
  stores: { storeId: number; storeName: string }[];
  // true면 password가 회사 관리자가 '매장 전화번호로 초기화'한 임시 비밀번호라고 본다.
  // 서버는 입력한 비밀번호가 연결 매장 전화번호 끝 8자리와 같은지로 판단한다.
  temporaryPassword?: boolean;
  note: string;
}

export const MOCK_OWNER_ACCOUNTS: MockOwnerAccount[] = [
  {
    ownerId: 1,
    loginId: "mock.single",
    password: "mock-only-password",
    stores: [{ storeId: 1, storeName: "보이스크 테스트 매장" }],
    note: "매장 1개 연결",
  },
  {
    ownerId: 2,
    loginId: "mock.multi",
    password: "mock-only-password",
    stores: [
      { storeId: 2, storeName: "보이스크 Mock 카페" },
      { storeId: 3, storeName: "보이스크 Mock 분식" },
    ],
    note: "매장 2개 연결",
  },
  {
    ownerId: 3,
    loginId: "mock.temp",
    // Mock 매장 데이터는 점주가 정해져 있어 이 계정에는 매장을 연결하지 않는다.
    password: "12345678",
    stores: [],
    temporaryPassword: true,
    note: "임시 비밀번호로 초기화된 상태(매장 없음)",
  },
];
