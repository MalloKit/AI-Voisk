// 개발용 Mock 계정. MockOwnerAuthRepository에서만 쓰고, 서버 API 모드에서는 로그인되지 않는다.
// 실제 운영 계정·비밀번호가 아니며 운영 DB에 이 값을 넣지 않는다.
export interface MockOwnerAccount {
  ownerId: number;
  loginId: string;
  password: string;
  stores: { storeId: number; storeName: string }[];
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
];
