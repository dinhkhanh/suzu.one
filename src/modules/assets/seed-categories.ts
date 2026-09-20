// The starter asset categories, group-wide, in Vietnamese. Seeded once per code by `pnpm db:seed`;
// whoever keeps the register edits them afterwards on Assets → Categories. Plain data: no I/O.
//
// `requiresSerial` is on wherever two of the thing would otherwise be indistinguishable, and
// `bookable` marks the shared production gear that people sign out rather than keep — the booking
// calendar of Phase 6 week 3 reads it.
import type { AssetKind } from "./enums";

export type CategorySeed = { code: string; name: string; kind: AssetKind; requiresSerial: boolean; defaultWarrantyMonths: number | null; bookable: boolean; sortOrder: number };

export const CATEGORY_SEED: CategorySeed[] = [
  { code: "LAP", name: "Máy tính xách tay", kind: "it_equipment", requiresSerial: true, defaultWarrantyMonths: 24, bookable: false, sortOrder: 1 },
  { code: "DESK", name: "Máy tính để bàn", kind: "it_equipment", requiresSerial: true, defaultWarrantyMonths: 24, bookable: false, sortOrder: 2 },
  { code: "MON", name: "Màn hình", kind: "it_equipment", requiresSerial: true, defaultWarrantyMonths: 24, bookable: false, sortOrder: 3 },
  { code: "PHO", name: "Điện thoại", kind: "phone_sim", requiresSerial: true, defaultWarrantyMonths: 12, bookable: false, sortOrder: 4 },
  { code: "SIM", name: "SIM / thuê bao", kind: "phone_sim", requiresSerial: false, defaultWarrantyMonths: null, bookable: false, sortOrder: 5 },
  { code: "CAM", name: "Máy quay / máy ảnh", kind: "production_gear", requiresSerial: true, defaultWarrantyMonths: 12, bookable: true, sortOrder: 10 },
  { code: "LEN", name: "Ống kính", kind: "production_gear", requiresSerial: true, defaultWarrantyMonths: 12, bookable: true, sortOrder: 11 },
  { code: "LGT", name: "Thiết bị ánh sáng", kind: "production_gear", requiresSerial: true, defaultWarrantyMonths: 12, bookable: true, sortOrder: 12 },
  { code: "AUD", name: "Thiết bị âm thanh", kind: "production_gear", requiresSerial: true, defaultWarrantyMonths: 12, bookable: true, sortOrder: 13 },
  { code: "GRIP", name: "Chân máy / phụ kiện quay", kind: "production_gear", requiresSerial: false, defaultWarrantyMonths: null, bookable: true, sortOrder: 14 },
  { code: "STOR", name: "Thẻ nhớ / ổ cứng", kind: "production_gear", requiresSerial: true, defaultWarrantyMonths: 12, bookable: true, sortOrder: 15 },
  { code: "DRN", name: "Flycam", kind: "production_gear", requiresSerial: true, defaultWarrantyMonths: 12, bookable: true, sortOrder: 16 },
  { code: "FUR", name: "Bàn ghế, nội thất", kind: "furniture", requiresSerial: false, defaultWarrantyMonths: null, bookable: false, sortOrder: 20 },
  { code: "VEH", name: "Phương tiện", kind: "vehicle", requiresSerial: true, defaultWarrantyMonths: null, bookable: true, sortOrder: 30 },
  { code: "OTH", name: "Khác", kind: "other", requiresSerial: false, defaultWarrantyMonths: null, bookable: false, sortOrder: 90 },
];
