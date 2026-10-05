import type { GalleryPhotoListItem } from "@photographer-platform/shared";

export const LOCALE_COOKIE = "photographer_locale";

export type Locale = "en" | "vi";

export function isLocale(value: unknown): value is Locale {
  return value === "en" || value === "vi";
}

export function resolveLocale(value: unknown): Locale {
  return isLocale(value) ? value : "en";
}

type WorkflowStep = {
  title: string;
  detail: string;
};

type PageCopy = {
  brandTagline: string;
  languageLabel: string;
  connected: string;
  unavailable: string;
  introEyebrow: string;
  hero: string;
  introduction: string;
  foundationTitle: string;
  foundationDetail: string;
  flowEyebrow: string;
  flowTitle: string;
  workflow: readonly [WorkflowStep, WorkflowStep, WorkflowStep];
  sourceEyebrow: string;
  sourceTitle: string;
  sourceDetail: string;
  guaranteedHeading: string;
  bestEffortHeading: string;
  formatsNoun: string;
  guaranteedAriaLabel: string;
  bestEffortAriaLabel: string;
  formatsUnavailable: string;
  footerBuild: string;
  footerOriginals: string;
  metadataDescription: string;
};

export const pageCopy: Record<Locale, PageCopy> = {
  en: {
    brandTagline: "Photographer Platform",
    languageLabel: "Language",
    connected: "API connected",
    unavailable: "API unavailable",
    introEyebrow: "A workspace for photographers",
    hero: "Keep the originals. Simplify the proof.",
    introduction:
      "Built around the way photographers already work: original files in Google Drive, a focused gallery for clients, and a clear list of their final choices.",
    foundationTitle: "Foundation in progress",
    foundationDetail:
      "Secure sign-in, selection review and filename exports are implemented. Authorized galleries can collect client choices; Drive folder import, advanced image decoding and live validation are still in progress.",
    flowEyebrow: "The product flow",
    flowTitle: "From Drive folder to final selection.",
    workflow: [
      { title: "Connect Drive", detail: "Authorize access to a photography folder." },
      { title: "Publish a gallery", detail: "Index images and share a private proofing link." },
      { title: "Collect choices", detail: "Clients select and comment; you export filenames." },
    ],
    sourceEyebrow: "Source images",
    sourceTitle: "A wider format vocabulary.",
    sourceDetail:
      "This catalog comes from the running API and shared format policy. Recognition and supported raster previews are implemented; other decoder coverage remains in progress.",
    guaranteedHeading: "Planned guaranteed source families",
    bestEffortHeading: "Best-effort source families",
    formatsNoun: "formats",
    guaranteedAriaLabel: "Guaranteed source formats",
    bestEffortAriaLabel: "Best-effort source formats",
    formatsUnavailable:
      "Format capabilities are temporarily unavailable. Start the API service and refresh this page.",
    footerBuild: "Photographer Platform · foundation build",
    footerOriginals: "Originals remain in Google Drive",
    metadataDescription: "Drive-backed photo proofing for photographers and their clients.",
  },
  vi: {
    brandTagline: "Duyệt ảnh với Google Drive",
    languageLabel: "Ngôn ngữ",
    connected: "Đã kết nối API",
    unavailable: "Không thể kết nối API",
    introEyebrow: "Không gian làm việc cho nhiếp ảnh gia",
    hero: "Giữ nguyên ảnh gốc. Duyệt ảnh dễ dàng hơn.",
    introduction:
      "Được thiết kế theo cách nhiếp ảnh gia vẫn làm việc: ảnh gốc nằm trong Google Drive, khách hàng xem ảnh trong một thư viện gọn gàng và bạn nhận được danh sách ảnh họ chọn.",
    foundationTitle: "Đang xây dựng nền tảng",
    foundationDetail:
      "Đăng nhập an toàn, xem lựa chọn và xuất tên tệp đã được triển khai. Thư viện được cấp quyền có thể nhận lựa chọn của khách hàng; nhập thư mục Drive, giải mã ảnh nâng cao và xác minh thực tế vẫn đang được hoàn thiện.",
    flowEyebrow: "Quy trình sử dụng",
    flowTitle: "Từ thư mục Drive đến danh sách ảnh được chọn.",
    workflow: [
      { title: "Kết nối Drive", detail: "Cấp quyền truy cập vào thư mục ảnh." },
      { title: "Chia sẻ thư viện", detail: "Lập danh mục ảnh và chia sẻ liên kết duyệt ảnh riêng tư." },
      { title: "Nhận lựa chọn", detail: "Khách hàng chọn và nhận xét ảnh; bạn xuất danh sách tên tệp." },
    ],
    sourceEyebrow: "Ảnh nguồn",
    sourceTitle: "Hỗ trợ nhiều định dạng ảnh hơn.",
    sourceDetail:
      "Danh mục này lấy từ API đang chạy và chính sách định dạng dùng chung. Hệ thống đã nhận diện định dạng và tạo ảnh xem trước cho một số định dạng; khả năng giải mã các định dạng khác vẫn đang được xây dựng.",
    guaranteedHeading: "Nhóm định dạng dự kiến hỗ trợ đầy đủ",
    bestEffortHeading: "Nhóm định dạng hỗ trợ tùy khả năng",
    formatsNoun: "định dạng",
    guaranteedAriaLabel: "Định dạng ảnh nguồn được bảo đảm hỗ trợ",
    bestEffortAriaLabel: "Định dạng ảnh nguồn hỗ trợ tùy khả năng",
    formatsUnavailable:
      "Tạm thời không thể tải thông tin định dạng. Hãy khởi động dịch vụ API rồi tải lại trang.",
    footerBuild: "Photographer Platform · bản nền tảng",
    footerOriginals: "Ảnh gốc vẫn nằm trong Google Drive",
    metadataDescription: "Duyệt và chọn ảnh từ Google Drive dành cho nhiếp ảnh gia và khách hàng.",
  },
};

export type GalleryCopy = {
  languageLabel: string;
  eyebrow: string;
  fallbackTitle: string;
  galleryDescription: string;
  pageCount: (count: number) => string;
  selectionLimit: (limit: number) => string;
  indexTitle: string;
  noPreview: string;
  dimensionsUnknown: string;
  empty: string;
  paginationLabel: string;
  firstPage: string;
  nextPage: string;
  openPreview: (fileName: string) => string;
  closePreview: string;
  previousPhoto: string;
  nextPhoto: string;
  previewNavigationLabel: string;
  previewHelp: string;
  previewUnavailable: string;
  photoPosition: (position: number, count: number) => string;
  passwordLabel: string;
  passwordHint: string;
  unlockButton: string;
  unlockErrors: Record<"denied" | "rate-limited" | "unavailable" | "invalid", string>;
  selectionUnavailable: string;
  selectedCount: (count: number, limit: number | null) => string;
  selectionLimitReached: string;
  selectPhoto: string;
  deselectPhoto: string;
  commentLabel: string;
  saveComment: string;
  submitSelection: string;
  confirmSubmission: string;
  confirmSubmit: string;
  cancelSubmit: string;
  submittedSelection: string;
  lockedSelection: string;
  selectionErrors: Record<"invalid" | "authorization" | "rate-limited" | "conflict" | "unavailable", string>;
  originalsNote: string;
  previewStatus: Record<GalleryPhotoListItem["previewStatus"], string>;
  states: Record<"password-required" | "not-found" | "unavailable" | "stale" | "invalid", string>;
};

export const galleryCopy: Record<Locale, GalleryCopy> = {
  en: {
    languageLabel: "Language",
    eyebrow: "Client gallery",
    fallbackTitle: "Gallery",
    galleryDescription: "Browse generated previews, select favorites, and submit your final choices.",
    pageCount: (count) => `${count} photos on this page`,
    selectionLimit: (limit) => `Selection limit: ${limit}`,
    indexTitle: "Photo index",
    noPreview: "Generated previews only — original files are never loaded",
    dimensionsUnknown: "Dimensions unavailable",
    empty: "No photos are indexed in this gallery yet.",
    paginationLabel: "Gallery pages",
    firstPage: "First page",
    nextPage: "Next page",
    openPreview: (fileName) => `Open preview of ${fileName}`,
    closePreview: "Close preview",
    previousPhoto: "Previous photo",
    nextPhoto: "Next photo",
    previewNavigationLabel: "Preview navigation",
    previewHelp: "Swipe left or right, use the arrow keys, or use the buttons to browse this page.",
    previewUnavailable: "This preview could not be loaded. The original remains in Google Drive.",
    photoPosition: (position, count) => `Photo ${position} of ${count} on this page`,
    passwordLabel: "Gallery password",
    passwordHint: "Enter the password shared by your photographer to view this gallery.",
    unlockButton: "Open gallery",
    unlockErrors: {
      denied: "That password did not open this gallery. Please try again.",
      "rate-limited": "Too many attempts. Please wait before trying again.",
      unavailable: "Password access is temporarily unavailable. Please try again later.",
      invalid: "Enter a password of at most 1024 bytes.",
    },
    selectionUnavailable: "Selection is temporarily unavailable. You can still browse this gallery.",
    selectedCount: (count, limit) => limit === null ? `${count} selected` : `${count} of ${limit} selected`,
    selectionLimitReached: "Selection limit reached. Deselect a photo to choose another.",
    selectPhoto: "Select photo",
    deselectPhoto: "Deselect photo",
    commentLabel: "Comment on this photo",
    saveComment: "Save comment",
    submitSelection: "Submit selection",
    confirmSubmission: "Submit your selected photos? You cannot change them afterward.",
    confirmSubmit: "Confirm submission",
    cancelSubmit: "Cancel",
    submittedSelection: "Your selection has been submitted. Thank you.",
    lockedSelection: "This selection is locked and cannot be changed.",
    selectionErrors: {
      invalid: "That selection request was invalid. Refresh the page and try again.",
      authorization: "Your gallery access changed. Refresh the page and enter the password again if needed.",
      "rate-limited": "Too many changes. Please wait a moment before trying again.",
      conflict: "The selection changed or reached its limit. Refresh the page to see the latest state.",
      unavailable: "Selection is temporarily unavailable. Please try again later.",
    },
    originalsNote: "Original photographs remain in Google Drive.",
    previewStatus: {
      PENDING: "Preview pending",
      READY: "Preview ready",
      UNSUPPORTED_VARIANT: "Preview format unsupported",
      FAILED: "Preview failed",
    },
    states: {
      "password-required": "This gallery is password-protected. Its photos remain hidden until you enter the password.",
      "not-found": "This gallery is unavailable or has not been published.",
      unavailable: "The gallery service is unavailable. Please try again later.",
      stale: "This gallery changed while you were browsing. Return to the first page to continue.",
      invalid: "This gallery link or page cursor is invalid.",
    },
  },
  vi: {
    languageLabel: "Ngôn ngữ",
    eyebrow: "Thư viện ảnh cho khách hàng",
    fallbackTitle: "Thư viện ảnh",
    galleryDescription: "Xem ảnh đã được tạo, chọn ảnh yêu thích và gửi lựa chọn cuối cùng.",
    pageCount: (count) => `${count} ảnh trên trang này`,
    selectionLimit: (limit) => `Giới hạn chọn ảnh: ${limit}`,
    indexTitle: "Danh sách ảnh",
    noPreview: "Chỉ tải ảnh xem trước đã tạo — không tải ảnh gốc",
    dimensionsUnknown: "Chưa có kích thước",
    empty: "Thư viện này chưa có ảnh được lập danh mục.",
    paginationLabel: "Các trang thư viện",
    firstPage: "Trang đầu",
    nextPage: "Trang tiếp theo",
    openPreview: (fileName) => `Mở ảnh xem trước ${fileName}`,
    closePreview: "Đóng ảnh xem trước",
    previousPhoto: "Ảnh trước",
    nextPhoto: "Ảnh tiếp theo",
    previewNavigationLabel: "Chuyển ảnh xem trước",
    previewHelp: "Vuốt sang trái hoặc phải, dùng phím mũi tên hoặc các nút để xem ảnh trên trang này.",
    previewUnavailable: "Không thể tải ảnh xem trước. Ảnh gốc vẫn nằm trong Google Drive.",
    photoPosition: (position, count) => `Ảnh ${position} trong ${count} ảnh trên trang này`,
    passwordLabel: "Mật khẩu thư viện",
    passwordHint: "Nhập mật khẩu nhiếp ảnh gia đã chia sẻ để xem thư viện này.",
    unlockButton: "Mở thư viện",
    unlockErrors: {
      denied: "Mật khẩu chưa đúng. Vui lòng thử lại.",
      "rate-limited": "Bạn đã thử quá nhiều lần. Vui lòng chờ trước khi thử lại.",
      unavailable: "Tạm thời không thể mở thư viện bằng mật khẩu. Vui lòng thử lại sau.",
      invalid: "Nhập mật khẩu không quá 1024 byte.",
    },
    selectionUnavailable: "Tạm thời không thể chọn ảnh. Bạn vẫn có thể xem thư viện.",
    selectedCount: (count, limit) => limit === null ? `Đã chọn ${count} ảnh` : `Đã chọn ${count}/${limit} ảnh`,
    selectionLimitReached: "Đã đạt giới hạn. Hãy bỏ chọn một ảnh để chọn ảnh khác.",
    selectPhoto: "Chọn ảnh",
    deselectPhoto: "Bỏ chọn ảnh",
    commentLabel: "Nhận xét về ảnh này",
    saveComment: "Lưu nhận xét",
    submitSelection: "Gửi danh sách ảnh",
    confirmSubmission: "Gửi các ảnh đã chọn? Sau đó bạn không thể thay đổi lựa chọn.",
    confirmSubmit: "Xác nhận gửi",
    cancelSubmit: "Hủy",
    submittedSelection: "Bạn đã gửi danh sách ảnh thành công. Cảm ơn bạn.",
    lockedSelection: "Danh sách ảnh đã được khóa và không thể chỉnh sửa.",
    selectionErrors: {
      invalid: "Yêu cầu chọn ảnh không hợp lệ. Hãy tải lại trang và thử lại.",
      authorization: "Quyền truy cập thư viện đã thay đổi. Hãy tải lại trang và nhập lại mật khẩu nếu cần.",
      "rate-limited": "Bạn đã thay đổi quá nhiều lần. Vui lòng chờ rồi thử lại.",
      conflict: "Danh sách ảnh đã thay đổi hoặc đạt giới hạn. Hãy tải lại trang để xem trạng thái mới nhất.",
      unavailable: "Tạm thời không thể chọn ảnh. Vui lòng thử lại sau.",
    },
    originalsNote: "Ảnh gốc vẫn được lưu trong Google Drive.",
    previewStatus: {
      PENDING: "Đang chờ ảnh xem trước",
      READY: "Ảnh xem trước đã sẵn sàng",
      UNSUPPORTED_VARIANT: "Chưa hỗ trợ định dạng xem trước",
      FAILED: "Tạo ảnh xem trước thất bại",
    },
    states: {
      "password-required": "Thư viện này được bảo vệ bằng mật khẩu. Ảnh chỉ hiển thị sau khi bạn nhập mật khẩu.",
      "not-found": "Thư viện này không khả dụng hoặc chưa được xuất bản.",
      unavailable: "Dịch vụ thư viện hiện không khả dụng. Vui lòng thử lại sau.",
      stale: "Thư viện đã thay đổi trong lúc bạn xem. Hãy trở về trang đầu để tiếp tục.",
      invalid: "Liên kết thư viện hoặc mã trang không hợp lệ.",
    },
  },
};
