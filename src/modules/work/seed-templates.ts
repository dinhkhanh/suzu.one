// Starter project templates (FR-WRK-10), shared by every team, in Vietnamese. Seeded once per name
// by `pnpm db:seed`; teams copy the idea into their own templates on Work → Templates. Plain data.
// `day` counts from day 0, the date given when the template is used (a kick-off, a go-live, an event day); negative = before it.
type SeedStep = { title: string; role?: string; day: number; hours?: number; description?: string; steps?: Omit<SeedStep, "steps">[] };

export const WORK_TEMPLATE_SEED: { purpose: "work_project" | "work_task"; name: string; description: string; steps: SeedStep[] }[] = [
  {
    purpose: "work_project",
    name: "Retainer social hàng tháng",
    description: "Một tháng vận hành kênh social cho khách hàng retainer: kế hoạch → sản xuất → duyệt → đăng → báo cáo. Ngày 0 = ngày 1 của tháng.",
    steps: [
      { title: "Họp định hướng tháng với khách hàng", role: "account", day: -7, hours: 2 },
      {
        title: "Kế hoạch nội dung tháng (content calendar)",
        role: "strategist",
        day: -4,
        hours: 8,
        steps: [
          { title: "Rà soát số liệu tháng trước và insight", role: "strategist", day: -6, hours: 3 },
          { title: "Đề xuất tuyến nội dung và lịch đăng", role: "strategist", day: -5, hours: 4 },
          { title: "Khách hàng duyệt kế hoạch tháng", role: "account", day: -3, hours: 1 },
        ],
      },
      {
        title: "Sản xuất nội dung đợt 1 (tuần 1–2)",
        role: "account",
        day: 0,
        steps: [
          { title: "Viết caption và kịch bản video ngắn đợt 1", role: "copywriter", day: -2, hours: 10 },
          { title: "Thiết kế hình ảnh đợt 1", role: "designer", day: -1, hours: 12 },
          { title: "Dựng video ngắn đợt 1", role: "editor", day: -1, hours: 8 },
          { title: "Duyệt nội bộ và gửi khách hàng duyệt đợt 1", role: "account", day: 0, hours: 2 },
        ],
      },
      {
        title: "Sản xuất nội dung đợt 2 (tuần 3–4)",
        role: "account",
        day: 14,
        steps: [
          { title: "Viết caption và kịch bản video ngắn đợt 2", role: "copywriter", day: 10, hours: 10 },
          { title: "Thiết kế hình ảnh đợt 2", role: "designer", day: 12, hours: 12 },
          { title: "Dựng video ngắn đợt 2", role: "editor", day: 12, hours: 8 },
          { title: "Duyệt nội bộ và gửi khách hàng duyệt đợt 2", role: "account", day: 14, hours: 2 },
        ],
      },
      { title: "Lên lịch đăng và theo dõi bình luận, tin nhắn", role: "community", day: 1, hours: 20, description: "Lên lịch trên Meta Business Suite / TikTok; trả lời bình luận trong 2 giờ làm việc." },
      { title: "Thiết lập và tối ưu quảng cáo tháng", role: "media", day: 3, hours: 8 },
      { title: "Báo cáo giữa tháng cho khách hàng", role: "account", day: 15, hours: 3 },
      { title: "Báo cáo tháng và đề xuất tháng sau", role: "strategist", day: 33, hours: 6 },
      { title: "Nghiệm thu và gửi đề nghị thanh toán", role: "account", day: 35, hours: 1 },
    ],
  },
  {
    purpose: "work_project",
    name: "Sản xuất video / TVC",
    description: "Từ brief đến bàn giao bản master. Ngày 0 = ngày bắt đầu dự án; hoặc chọn để bước cuối rơi vào ngày bàn giao.",
    steps: [
      { title: "Nhận brief và chốt phạm vi, ngân sách, timeline", role: "account", day: 0, hours: 3 },
      {
        title: "Tiền kỳ",
        role: "producer",
        day: 12,
        steps: [
          { title: "Ý tưởng và kịch bản", role: "copywriter", day: 4, hours: 16 },
          { title: "Storyboard / shot list", role: "director", day: 7, hours: 12 },
          { title: "Khách hàng duyệt kịch bản và storyboard", role: "account", day: 9, hours: 2 },
          { title: "Casting, bối cảnh, đạo cụ, thiết bị", role: "producer", day: 11, hours: 16 },
          { title: "Họp PPM với khách hàng", role: "producer", day: 12, hours: 3 },
        ],
      },
      { title: "Ngày quay", role: "director", day: 15, hours: 12, description: "Call sheet gửi trước 24 giờ. Sao lưu footage hai bản ngay sau khi quay." },
      {
        title: "Hậu kỳ",
        role: "editor",
        day: 27,
        steps: [
          { title: "Dựng thô (offline)", role: "editor", day: 19, hours: 16 },
          { title: "Duyệt nội bộ bản dựng thô", role: "director", day: 20, hours: 2 },
          { title: "Khách hàng duyệt bản dựng — vòng 1", role: "account", day: 22, hours: 2 },
          { title: "Chỉnh màu, âm thanh, nhạc, đồ họa", role: "editor", day: 25, hours: 16 },
          { title: "Khách hàng duyệt bản hoàn thiện — vòng 2", role: "account", day: 27, hours: 2 },
        ],
      },
      { title: "Xuất bản master và các phiên bản theo nền tảng", role: "editor", day: 29, hours: 4 },
      { title: "Bàn giao, lưu trữ dự án và nghiệm thu", role: "producer", day: 30, hours: 3 },
    ],
  },
  {
    purpose: "work_project",
    name: "Chiến dịch KOL / KOC",
    description: "Tuyển chọn, booking, sản xuất nội dung cùng KOL và báo cáo. Ngày 0 = ngày bài đăng đầu tiên lên sóng.",
    steps: [
      { title: "Chốt mục tiêu, ngân sách và KPI chiến dịch", role: "account", day: -21, hours: 3 },
      { title: "Lập danh sách KOL đề xuất kèm số liệu", role: "strategist", day: -17, hours: 10 },
      { title: "Khách hàng duyệt danh sách KOL", role: "account", day: -14, hours: 1 },
      { title: "Đàm phán, booking và ký hợp đồng KOL", role: "booking", day: -10, hours: 12 },
      { title: "Viết brief nội dung cho từng KOL", role: "copywriter", day: -9, hours: 8 },
      { title: "Gửi sản phẩm / sắp xếp trải nghiệm cho KOL", role: "booking", day: -7, hours: 4 },
      { title: "Duyệt nội dung nháp của KOL (nội bộ và khách hàng)", role: "account", day: -3, hours: 6 },
      { title: "Theo dõi bài đăng đúng lịch, đúng thông điệp", role: "community", day: 0, hours: 6 },
      { title: "Chạy quảng cáo khuếch đại (whitelist / spark ads)", role: "media", day: 2, hours: 6 },
      { title: "Thu thập số liệu từ KOL và nền tảng", role: "strategist", day: 14, hours: 4 },
      { title: "Báo cáo chiến dịch", role: "strategist", day: 18, hours: 8 },
      { title: "Thanh toán KOL và nghiệm thu với khách hàng", role: "account", day: 21, hours: 3 },
    ],
  },
  {
    purpose: "work_project",
    name: "Sự kiện",
    description: "Tổ chức sự kiện cho khách hàng. Ngày 0 = ngày diễn ra sự kiện: các bước chuẩn bị có số ngày âm, các bước sau sự kiện có số ngày dương.",
    steps: [
      { title: "Nhận brief, khảo sát nhu cầu và ngân sách", role: "account", day: -45, hours: 4 },
      { title: "Concept, kịch bản chương trình và đề xuất địa điểm", role: "strategist", day: -38, hours: 16 },
      { title: "Khách hàng duyệt concept và ngân sách", role: "account", day: -33, hours: 2 },
      {
        title: "Chuẩn bị",
        role: "producer",
        day: -2,
        steps: [
          { title: "Đặt địa điểm, xin giấy phép tổ chức", role: "producer", day: -30, hours: 8 },
          { title: "Thiết kế key visual, backdrop, ấn phẩm", role: "designer", day: -21, hours: 24 },
          { title: "Booking MC, khách mời, tiết mục", role: "booking", day: -20, hours: 10 },
          { title: "Chốt nhà cung cấp âm thanh, ánh sáng, sân khấu, tiệc", role: "producer", day: -14, hours: 10 },
          { title: "Truyền thông trước sự kiện và gửi thư mời", role: "community", day: -10, hours: 12 },
          { title: "In ấn, sản xuất vật phẩm", role: "designer", day: -5, hours: 6 },
          { title: "Tổng duyệt chương trình", role: "producer", day: -1, hours: 6 },
        ],
      },
      { title: "Ngày sự kiện: điều phối tại chỗ", role: "producer", day: 0, hours: 12 },
      { title: "Quay chụp và video recap", role: "editor", day: 5, hours: 16 },
      { title: "Báo cáo sau sự kiện", role: "account", day: 7, hours: 4 },
      { title: "Quyết toán nhà cung cấp và nghiệm thu", role: "account", day: 14, hours: 4 },
    ],
  },
  {
    purpose: "work_task",
    name: "Bài đăng social (một bài)",
    description: "Một bài đăng từ ý tưởng đến lên lịch. Ngày 0 = ngày đăng.",
    steps: [
      {
        title: "Bài đăng social",
        role: "account",
        day: 0,
        steps: [
          { title: "Viết caption", role: "copywriter", day: -4, hours: 2 },
          { title: "Thiết kế hình / dựng video ngắn", role: "designer", day: -3, hours: 4 },
          { title: "Duyệt nội bộ", role: "account", day: -2, hours: 1 },
          { title: "Khách hàng duyệt", role: "account", day: -1, hours: 1 },
          { title: "Lên lịch đăng", role: "community", day: 0, hours: 1 },
        ],
      },
    ],
  },
];
