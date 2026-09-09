const codeForm = document.querySelector("#codeForm");
const codeInput = document.querySelector("#codeInput");
const sampleButton = document.querySelector("#sampleButton");
const clearButton = document.querySelector("#clearButton");
const emptyState = document.querySelector("#emptyState");
const qrViewer = document.querySelector("#qrViewer");
const qrCanvas = document.querySelector("#qrCanvas");
const counter = document.querySelector("#counter");
const batchNote = document.querySelector("#batchNote");
const currentCode = document.querySelector("#currentCode");
const prevButton = document.querySelector("#prevButton");
const nextButton = document.querySelector("#nextButton");
const copyButton = document.querySelector("#copyButton");
const downloadButton = document.querySelector("#downloadButton");
const statusBox = document.querySelector("#status");

let codes = [];
let currentIndex = 0;

codeForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const parsedCodes = parseCodes(codeInput.value);
  if (parsedCodes.length === 0) {
    showStatus("請先貼上至少一個交貨便代碼。", true);
    hideViewer();
    return;
  }

  codes = parsedCodes;
  currentIndex = 0;

  try {
    await renderCurrentCode();
    showStatus(`已產生 ${codes.length} 張 QR Code。`);
  } catch (error) {
    console.error(error);
    hideViewer();
    showStatus("QR Code 產生失敗，請確認每行代碼不要過長。", true);
  }
});

sampleButton.addEventListener("click", () => {
  codeInput.value = ["A12345678901", "B12345678902", "C12345678903"].join("\n");
  codeInput.focus();
});

clearButton.addEventListener("click", () => {
  codeInput.value = "";
  codes = [];
  currentIndex = 0;
  hideViewer();
  showStatus("");
  codeInput.focus();
});

prevButton.addEventListener("click", async () => {
  if (currentIndex <= 0) {
    return;
  }

  currentIndex -= 1;
  await safelyRenderCurrentCode();
});

nextButton.addEventListener("click", async () => {
  if (currentIndex >= codes.length - 1) {
    return;
  }

  currentIndex += 1;
  await safelyRenderCurrentCode();
});

copyButton.addEventListener("click", async () => {
  const code = codes[currentIndex];
  if (!code) {
    return;
  }

  try {
    await navigator.clipboard.writeText(code);
    showStatus("已複製目前代碼。");
  } catch {
    showStatus("無法自動複製，請手動選取代碼。", true);
  }
});

downloadButton.addEventListener("click", () => {
  const code = codes[currentIndex];
  if (!code) {
    return;
  }

  const link = document.createElement("a");
  link.download = `${sanitizeFileName(code)}.png`;
  link.href = qrCanvas.toDataURL("image/png");
  link.click();
});

document.addEventListener("keydown", async (event) => {
  if (qrViewer.hidden || event.target === codeInput) {
    return;
  }

  if (event.key === "ArrowLeft") {
    prevButton.click();
  }

  if (event.key === "ArrowRight" || event.key === " ") {
    event.preventDefault();
    nextButton.click();
  }
});

function parseCodes(rawValue) {
  const seen = new Set();

  return rawValue
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/\s+/g, ""))
    .filter((code) => {
      if (seen.has(code)) {
        return false;
      }
      seen.add(code);
      return true;
    });
}

async function renderCurrentCode() {
  const code = codes[currentIndex];
  if (!code) {
    hideViewer();
    return;
  }

  if (!window.LocalQRCode?.toCanvas) {
    showStatus("QR Code 產生器載入失敗，請重新整理頁面。", true);
    hideViewer();
    return;
  }

  emptyState.hidden = true;
  qrViewer.hidden = false;

  await window.LocalQRCode.toCanvas(qrCanvas, code, {
    margin: 2,
    width: 420,
    color: {
      dark: "#111814",
      light: "#ffffff",
    },
  });

  counter.textContent = `第 ${currentIndex + 1} / ${codes.length} 張`;
  batchNote.textContent = codes.length > 30 ? `超過 30 筆，App 可能需要分批送出` : "可逐張掃描";
  currentCode.textContent = code;
  prevButton.disabled = currentIndex === 0;
  nextButton.disabled = currentIndex === codes.length - 1;
}

async function safelyRenderCurrentCode() {
  try {
    await renderCurrentCode();
    showStatus("");
  } catch (error) {
    console.error(error);
    showStatus("這筆代碼無法產生 QR Code，請確認內容不要過長。", true);
  }
}

function hideViewer() {
  emptyState.hidden = false;
  qrViewer.hidden = true;
}

function showStatus(message, isError = false) {
  statusBox.textContent = message;
  statusBox.classList.toggle("error", isError);
}

function sanitizeFileName(value) {
  return value.replace(/[\\/:*?"<>|]/g, "_").slice(0, 80) || "qrcode";
}
