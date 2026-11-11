import type { OwnerAiRepository } from "./aiRepository";

// 메뉴 사진 올리기·지우기·주소 변환. 메뉴 관리 화면은 이 세 기능만 쓴다.
export type MenuPhotos = Pick<
  OwnerAiRepository,
  "uploadMenuImage" | "deleteMenuImage" | "imageSrc"
>;

export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const PHOTO_ACCEPT = PHOTO_TYPES.join(",");

// 업로드 전에 사진을 긴 변 800px JPEG로 줄인다. 서버 한도(900KB)를 넘지 않게 하려는 것이다.
export async function shrinkImage(file: File): Promise<Blob> {
  if (!PHOTO_TYPES.includes(file.type))
    throw new Error("JPG, PNG, WEBP 사진만 올릴 수 있습니다.");
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 800 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("canvas");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.85),
    );
    if (blob) return blob;
  } catch {
    // 브라우저가 변환하지 못하면 원본을 그대로 보냅니다.
  }
  if (file.size > 900 * 1024)
    throw new Error("사진을 줄이지 못했습니다. 900KB 이하 사진을 골라 주세요.");
  return file;
}
