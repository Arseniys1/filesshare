const DANGEROUS_EXTENSIONS = new Set([
  "ade", "adp", "apk", "appx", "bat", "cab", "cmd", "com", "cpl", "dll",
  "dmg", "exe", "hta", "inf", "ins", "iso", "jar", "js", "jse", "lnk",
  "msi", "msp", "mst", "ps1", "scr", "sh", "sys", "vbe", "vbs", "wsc", "wsf",
]);

export function validateUploadFileType(fileName: string, mimeType: string): void {
  const extension = fileName.toLowerCase().split(".").pop() || "";
  if (DANGEROUS_EXTENSIONS.has(extension)) {
    throw new Error("Загрузка исполняемых и потенциально опасных файлов запрещена");
  }
  if (!mimeType || mimeType.length > 255 || /[\r\n]/.test(mimeType)) {
    throw new Error("Некорректный MIME-тип файла");
  }
}
