export type SourceImageFormatId =
  | "jpeg"
  | "png"
  | "webp"
  | "avif"
  | "gif"
  | "heic"
  | "heif"
  | "tiff"
  | "dng"
  | "cr2"
  | "cr3"
  | "nef"
  | "nrw"
  | "arw"
  | "raf"
  | "orf"
  | "rw2"
  | "pef"
  | "rwl"
  | "srw"
  | "3fr"
  | "fff"
  | "iiq"
  | "x3f"
  | "mos"
  | "mef"
  | "erf"
  | "kdc"
  | "dcr"
  | "jxl"
  | "jpeg2000"
  | "bmp"
  | "psd"
  | "psb";

export type SourceImageKind =
  | "browser-native"
  | "converted-raster"
  | "camera-raw"
  | "extended-raster";

export type SourceImageSupportLevel = "guaranteed" | "best-effort";

export type PreviewStrategy =
  | "normalize-raster"
  | "extract-raw-preview"
  | "flatten-composite";

export interface SourceImageFormatDefinition {
  readonly id: SourceImageFormatId;
  readonly label: string;
  readonly kind: SourceImageKind;
  readonly supportLevel: SourceImageSupportLevel;
  readonly previewStrategy: PreviewStrategy;
  readonly extensions: readonly string[];
  readonly mimeTypes: readonly string[];
}

const defineFormat = (
  definition: SourceImageFormatDefinition,
): SourceImageFormatDefinition =>
  Object.freeze({
    ...definition,
    extensions: Object.freeze([...definition.extensions]),
    mimeTypes: Object.freeze([...definition.mimeTypes]),
  });

export const SOURCE_IMAGE_FORMATS: readonly SourceImageFormatDefinition[] =
  Object.freeze([
    defineFormat({ id: "jpeg", label: "JPEG", kind: "browser-native", supportLevel: "guaranteed", previewStrategy: "normalize-raster", extensions: ["jpg", "jpeg", "jpe", "jfif"], mimeTypes: ["image/jpeg", "image/jpg", "image/pjpeg"] }),
    defineFormat({ id: "png", label: "PNG/APNG", kind: "browser-native", supportLevel: "guaranteed", previewStrategy: "normalize-raster", extensions: ["png", "apng"], mimeTypes: ["image/png", "image/apng"] }),
    defineFormat({ id: "webp", label: "WebP", kind: "browser-native", supportLevel: "guaranteed", previewStrategy: "normalize-raster", extensions: ["webp"], mimeTypes: ["image/webp"] }),
    defineFormat({ id: "avif", label: "AVIF", kind: "browser-native", supportLevel: "guaranteed", previewStrategy: "normalize-raster", extensions: ["avif"], mimeTypes: ["image/avif"] }),
    defineFormat({ id: "gif", label: "GIF", kind: "browser-native", supportLevel: "guaranteed", previewStrategy: "normalize-raster", extensions: ["gif"], mimeTypes: ["image/gif"] }),
    defineFormat({ id: "heic", label: "HEIC", kind: "converted-raster", supportLevel: "guaranteed", previewStrategy: "normalize-raster", extensions: ["heic"], mimeTypes: ["image/heic", "image/heic-sequence"] }),
    defineFormat({ id: "heif", label: "HEIF/HIF", kind: "converted-raster", supportLevel: "guaranteed", previewStrategy: "normalize-raster", extensions: ["heif", "hif"], mimeTypes: ["image/heif", "image/heif-sequence"] }),
    defineFormat({ id: "tiff", label: "TIFF", kind: "converted-raster", supportLevel: "guaranteed", previewStrategy: "normalize-raster", extensions: ["tif", "tiff"], mimeTypes: ["image/tiff"] }),
    defineFormat({ id: "dng", label: "Digital Negative (DNG)", kind: "camera-raw", supportLevel: "guaranteed", previewStrategy: "extract-raw-preview", extensions: ["dng"], mimeTypes: ["image/dng", "image/x-adobe-dng"] }),
    defineFormat({ id: "cr2", label: "Canon RAW 2", kind: "camera-raw", supportLevel: "guaranteed", previewStrategy: "extract-raw-preview", extensions: ["cr2"], mimeTypes: ["image/x-canon-cr2"] }),
    defineFormat({ id: "cr3", label: "Canon RAW 3", kind: "camera-raw", supportLevel: "guaranteed", previewStrategy: "extract-raw-preview", extensions: ["cr3"], mimeTypes: ["image/x-canon-cr3"] }),
    defineFormat({ id: "nef", label: "Nikon Electronic Format", kind: "camera-raw", supportLevel: "guaranteed", previewStrategy: "extract-raw-preview", extensions: ["nef"], mimeTypes: ["image/x-nikon-nef"] }),
    defineFormat({ id: "nrw", label: "Nikon RAW", kind: "camera-raw", supportLevel: "guaranteed", previewStrategy: "extract-raw-preview", extensions: ["nrw"], mimeTypes: ["image/x-nikon-nrw"] }),
    defineFormat({ id: "arw", label: "Sony Alpha RAW", kind: "camera-raw", supportLevel: "guaranteed", previewStrategy: "extract-raw-preview", extensions: ["arw"], mimeTypes: ["image/x-sony-arw"] }),
    defineFormat({ id: "raf", label: "Fujifilm RAW", kind: "camera-raw", supportLevel: "guaranteed", previewStrategy: "extract-raw-preview", extensions: ["raf"], mimeTypes: ["image/x-fuji-raf"] }),
    defineFormat({ id: "orf", label: "Olympus/OM System RAW", kind: "camera-raw", supportLevel: "guaranteed", previewStrategy: "extract-raw-preview", extensions: ["orf"], mimeTypes: ["image/x-olympus-orf"] }),
    defineFormat({ id: "rw2", label: "Panasonic RAW 2", kind: "camera-raw", supportLevel: "guaranteed", previewStrategy: "extract-raw-preview", extensions: ["rw2"], mimeTypes: ["image/x-panasonic-rw2"] }),
    defineFormat({ id: "pef", label: "Pentax Electronic Format", kind: "camera-raw", supportLevel: "guaranteed", previewStrategy: "extract-raw-preview", extensions: ["pef"], mimeTypes: ["image/x-pentax-pef"] }),
    defineFormat({ id: "rwl", label: "Leica RAW", kind: "camera-raw", supportLevel: "best-effort", previewStrategy: "extract-raw-preview", extensions: ["rwl"], mimeTypes: ["image/x-leica-rwl"] }),
    defineFormat({ id: "srw", label: "Samsung RAW", kind: "camera-raw", supportLevel: "best-effort", previewStrategy: "extract-raw-preview", extensions: ["srw"], mimeTypes: ["image/x-samsung-srw"] }),
    defineFormat({ id: "3fr", label: "Hasselblad 3F RAW", kind: "camera-raw", supportLevel: "best-effort", previewStrategy: "extract-raw-preview", extensions: ["3fr"], mimeTypes: ["image/x-hasselblad-3fr"] }),
    defineFormat({ id: "fff", label: "Hasselblad RAW", kind: "camera-raw", supportLevel: "best-effort", previewStrategy: "extract-raw-preview", extensions: ["fff"], mimeTypes: ["image/x-hasselblad-fff"] }),
    defineFormat({ id: "iiq", label: "Phase One RAW", kind: "camera-raw", supportLevel: "best-effort", previewStrategy: "extract-raw-preview", extensions: ["iiq"], mimeTypes: ["image/x-phaseone-iiq"] }),
    defineFormat({ id: "x3f", label: "Sigma X3F", kind: "camera-raw", supportLevel: "best-effort", previewStrategy: "extract-raw-preview", extensions: ["x3f"], mimeTypes: ["image/x-sigma-x3f"] }),
    defineFormat({ id: "mos", label: "Leaf RAW", kind: "camera-raw", supportLevel: "best-effort", previewStrategy: "extract-raw-preview", extensions: ["mos"], mimeTypes: ["image/x-leaf-mos"] }),
    defineFormat({ id: "mef", label: "Mamiya RAW", kind: "camera-raw", supportLevel: "best-effort", previewStrategy: "extract-raw-preview", extensions: ["mef"], mimeTypes: ["image/x-mamiya-mef"] }),
    defineFormat({ id: "erf", label: "Epson RAW", kind: "camera-raw", supportLevel: "best-effort", previewStrategy: "extract-raw-preview", extensions: ["erf"], mimeTypes: ["image/x-epson-erf"] }),
    defineFormat({ id: "kdc", label: "Kodak Digital Camera RAW", kind: "camera-raw", supportLevel: "best-effort", previewStrategy: "extract-raw-preview", extensions: ["kdc"], mimeTypes: ["image/x-kodak-kdc"] }),
    defineFormat({ id: "dcr", label: "Kodak RAW", kind: "camera-raw", supportLevel: "best-effort", previewStrategy: "extract-raw-preview", extensions: ["dcr"], mimeTypes: ["image/x-kodak-dcr"] }),
    defineFormat({ id: "jxl", label: "JPEG XL", kind: "extended-raster", supportLevel: "best-effort", previewStrategy: "normalize-raster", extensions: ["jxl"], mimeTypes: ["image/jxl"] }),
    defineFormat({ id: "jpeg2000", label: "JPEG 2000", kind: "extended-raster", supportLevel: "best-effort", previewStrategy: "normalize-raster", extensions: ["jp2", "j2k", "j2c", "jpf", "jpx"], mimeTypes: ["image/jp2", "image/j2c", "image/jpx", "image/jpeg2000"] }),
    defineFormat({ id: "bmp", label: "Bitmap", kind: "extended-raster", supportLevel: "best-effort", previewStrategy: "normalize-raster", extensions: ["bmp", "dib"], mimeTypes: ["image/bmp", "image/x-ms-bmp"] }),
    defineFormat({ id: "psd", label: "Photoshop Document", kind: "extended-raster", supportLevel: "best-effort", previewStrategy: "flatten-composite", extensions: ["psd"], mimeTypes: ["image/vnd.adobe.photoshop", "image/x-photoshop"] }),
    defineFormat({ id: "psb", label: "Photoshop Large Document", kind: "extended-raster", supportLevel: "best-effort", previewStrategy: "flatten-composite", extensions: ["psb"], mimeTypes: ["application/vnd.adobe.photoshop", "image/x-photoshop-large"] }),
  ]);

const formatByExtension = new Map<string, SourceImageFormatDefinition>();
const formatByMimeType = new Map<string, SourceImageFormatDefinition>();

for (const format of SOURCE_IMAGE_FORMATS) {
  for (const extension of format.extensions) {
    formatByExtension.set(extension, format);
  }

  for (const mimeType of format.mimeTypes) {
    formatByMimeType.set(mimeType, format);
  }
}

const GENERIC_MIME_TYPES = new Set([
  "application/octet-stream",
  "application/x-raw",
  "binary/octet-stream",
  "image/raw",
]);

export interface SourceImageCandidate {
  readonly fileName: string;
  readonly mimeType?: string | null;
}

export type SourceImageClassificationWarning =
  | "generic-mime-type"
  | "mime-extension-conflict"
  | "unrecognized-mime-type";

export type SourceImageClassification =
  | {
      readonly status: "recognized";
      readonly format: SourceImageFormatDefinition;
      readonly evidence: "extension" | "mime-type" | "both";
      readonly extension: string | null;
      readonly normalizedMimeType: string | null;
      readonly warnings: readonly SourceImageClassificationWarning[];
    }
  | {
      readonly status: "unrecognized";
      readonly reason: "missing-format-evidence" | "unsupported-format";
      readonly extension: string | null;
      readonly normalizedMimeType: string | null;
    };

const normalizeMimeType = (mimeType: string | null | undefined): string | null => {
  if (mimeType === null || mimeType === undefined) {
    return null;
  }

  const normalized = mimeType.split(";", 1)[0]?.trim().toLowerCase();
  return normalized === undefined || normalized.length === 0 ? null : normalized;
};

const getExtension = (fileName: string): string | null => {
  const baseName = fileName.split(/[\\/]/).at(-1) ?? fileName;
  const lastDot = baseName.lastIndexOf(".");

  if (lastDot < 0 || lastDot === baseName.length - 1) {
    return null;
  }

  return baseName.slice(lastDot + 1).toLowerCase();
};

export const classifySourceImage = (
  candidate: SourceImageCandidate,
): SourceImageClassification => {
  const extension = getExtension(candidate.fileName);
  const normalizedMimeType = normalizeMimeType(candidate.mimeType);
  const extensionFormat = extension === null ? undefined : formatByExtension.get(extension);
  const mimeFormat =
    normalizedMimeType === null ? undefined : formatByMimeType.get(normalizedMimeType);
  const isGenericMime =
    normalizedMimeType !== null && GENERIC_MIME_TYPES.has(normalizedMimeType);

  if (extensionFormat !== undefined) {
    const warnings: SourceImageClassificationWarning[] = [];

    if (isGenericMime) {
      warnings.push("generic-mime-type");
    } else if (normalizedMimeType !== null && mimeFormat === undefined) {
      warnings.push("unrecognized-mime-type");
    } else if (mimeFormat !== undefined && mimeFormat.id !== extensionFormat.id) {
      warnings.push("mime-extension-conflict");
    }

    return {
      status: "recognized",
      format: extensionFormat,
      evidence: mimeFormat?.id === extensionFormat.id ? "both" : "extension",
      extension,
      normalizedMimeType,
      warnings: Object.freeze(warnings),
    };
  }

  if (mimeFormat !== undefined) {
    return {
      status: "recognized",
      format: mimeFormat,
      evidence: "mime-type",
      extension,
      normalizedMimeType,
      warnings: Object.freeze([]),
    };
  }

  return {
    status: "unrecognized",
    reason:
      extension === null && normalizedMimeType === null
        ? "missing-format-evidence"
        : "unsupported-format",
    extension,
    normalizedMimeType,
  };
};
