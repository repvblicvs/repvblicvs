/* Original, dependency-free CSV inspection. No network calls or type coercion. */
(function () {
  "use strict";
  const MAX_BYTES = 2 * 1024 * 1024;
  const SAMPLE = 'record_id,name,note,amount\r\n00127,"North, studio","Two lines:\nkeep both",19.50\r\n00008,Workshop,"She said ""ready""",0.00\r\n';
  const INTAKE = "Repvblicvs scope review\n\nWhat result do you need?\n\nWhat needs to change or be produced?\n\nRelevant software, formats, or versions (if applicable):\n\nFailing command for software issues (remove private paths):\n\nShort brief, source sample, or original synthetic input:\n\nExpected result / acceptance check:\n\nI have removed credentials, secrets, personal information, and confidential records from this example.\n";
  class CSVError extends Error {
    constructor(message, line, column) {
      super(message + " (line " + line + ", column " + column + ").");
      this.name = "CSVError";
      this.line = line;
      this.column = column;
    }
  }
  function parseCSV(source) {
    if (typeof source !== "string") throw new TypeError("CSV input must be text.");
    const text = source.charCodeAt(0) === 0xFEFF ? source.slice(1) : source;
    if (text === "") return [];
    const rows = [];
    let row = [], field = "", state = "start", line = 1, column = 1;
    let lastWasRecordEnd = false;
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const isLineEnd = char === "\n" || char === "\r";
      lastWasRecordEnd = false;
      if (state === "quoted") {
        if (char === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; column += 2; }
          else { state = "closed"; column++; }
        } else if (isLineEnd) {
          field += char;
          if (char === "\r" && text[i + 1] === "\n") { field += "\n"; i++; }
          line++; column = 1;
        } else { field += char; column++; }
        continue;
      }
      if (char === ",") {
        row.push(field); field = ""; state = "start"; column++;
      } else if (isLineEnd) {
        row.push(field); rows.push(row); row = []; field = ""; state = "start";
        if (char === "\r" && text[i + 1] === "\n") i++;
        line++; column = 1; lastWasRecordEnd = true;
      } else if (char === '"') {
        if (state !== "start") throw new CSVError("Unexpected quote in an unquoted field", line, column);
        state = "quoted"; column++;
      } else {
        if (state === "closed") throw new CSVError("Expected a comma or record ending after a closing quote", line, column);
        field += char; state = "unquoted"; column++;
      }
    }
    if (state === "quoted") throw new CSVError("Quoted field is not closed", line, column);
    if (!lastWasRecordEnd) { row.push(field); rows.push(row); }
    return rows;
  }
  function inspectCSV(source) {
    const records = parseCSV(source);
    const headers = records.length ? records[0] : [];
    const rows = records.slice(1);
    const issues = [];
    let noticeCount = 0;
    const add = (code, message) => {
      noticeCount++;
      if (issues.length < 100) issues.push({ code, message });
    };
    if (!records.length) add("empty", "Input is empty. Add a header row and data to inspect.");
    const seen = new Map();
    headers.forEach((header, index) => {
      if (header === "") add("blank-header", "Column " + (index + 1) + " has an empty header.");
      if (seen.has(header)) add("duplicate-header", "Header " + JSON.stringify(header) + " repeats at column " + (index + 1) + " (first at column " + seen.get(header) + ").");
      else seen.set(header, index + 1);
    });
    let mismatchCount = 0, formulaCount = 0;
    rows.forEach((record, index) => {
      if (record.length !== headers.length) {
        mismatchCount++;
        if (mismatchCount <= 10) add("row-width", "Record " + (index + 2) + " has " + record.length + " fields; the header has " + headers.length + ".");
      }
    });
    records.forEach((record, rowIndex) => record.forEach((cell, columnIndex) => {
      if (/^[\s\uFEFF]*[=+\-@]/u.test(cell)) {
        formulaCount++;
        if (formulaCount <= 6) add("formula-like", "Record " + (rowIndex + 1) + ", column " + (columnIndex + 1) + " starts like a spreadsheet formula. It remains a string here; be careful opening the original CSV in a spreadsheet.");
      }
    }));
    if (mismatchCount > 10) add("row-width", (mismatchCount - 10) + " additional records have an uneven field count.");
    if (formulaCount > 6) add("formula-like", (formulaCount - 6) + " additional cells start like spreadsheet formulas.");
    if (records.length === 1) add("no-data", "There is a header row but no data records.");
    return { headers, rows, issues, noticeCount, mismatchCount, formulaCount };
  }
  function rawOffset(source, displayOffset) {
    let raw = 0, displayed = 0;
    while (raw < source.length && displayed < displayOffset) {
      if (source[raw] === "\r" && source[raw + 1] === "\n") raw += 2;
      else raw++;
      displayed++;
    }
    return raw;
  }
  function reconcileText(source, displayText) {
    const previous = source.replace(/\r\n?/g, "\n");
    if (previous === displayText) return source;
    let start = 0, oldEnd = previous.length, newEnd = displayText.length;
    while (start < oldEnd && start < newEnd && previous[start] === displayText[start]) start++;
    while (oldEnd > start && newEnd > start && previous[oldEnd - 1] === displayText[newEnd - 1]) { oldEnd--; newEnd--; }
    return source.slice(0, rawOffset(source, start)) + displayText.slice(start, newEnd) + source.slice(rawOffset(source, oldEnd));
  }
  const api = { parseCSV, inspectCSV, reconcileText, CSVError, SAMPLE };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof document === "undefined") return;
  const byId = id => document.getElementById(id);
  const input = byId("csv-input");
  if (!input) return;
  const summary = byId("result-summary"), issueList = byId("issues"), headerList = byId("headers");
  const preview = byId("json-preview"), downloadButton = byId("download-button"), resultState = byId("result-state");
  let downloadable = null, rawInput = "", sourceFileName = "";
  let inputGeneration = 0, pendingFileRead = false;
  function cancelPendingRead() {
    inputGeneration++;
    if (pendingFileRead) {
      pendingFileRead = false;
      byId("csv-file").value = "";
      byId("file-name").textContent = sourceFileName;
    }
  }
  function addIssue(message, className) {
    const item = document.createElement("li");
    item.textContent = message;
    if (className) item.className = className;
    issueList.appendChild(item);
  }
  function clearResults() {
    issueList.replaceChildren(); headerList.replaceChildren();
    byId("header-count").textContent = "";
    summary.classList.remove("error"); downloadable = null; downloadButton.disabled = true;
  }
  function showError(message) {
    clearResults(); summary.textContent = "Inspection stopped."; summary.classList.add("error");
    resultState.textContent = "INPUT ERROR"; addIssue(message, "error"); preview.textContent = "No JSON generated. Resolve the input error and inspect again.";
  }
  function inspect() {
    clearResults();
    try {
      if (new TextEncoder().encode(rawInput).length > MAX_BYTES) throw new Error("Input exceeds the 2 MB limit. Use a smaller synthetic example.");
      const result = inspectCSV(rawInput);
      summary.textContent = result.headers.length + " columns / " + result.rows.length + " data records / " + result.noticeCount + " notices";
      resultState.textContent = !result.headers.length ? "EMPTY INPUT" : result.issues.length ? "REVIEW NOTICES" : "PARSED";
      byId("header-count").textContent = "(" + result.headers.length + ")";
      result.headers.slice(0, 40).forEach((header, index) => {
        const chip = document.createElement("span"); chip.className = "header-chip";
        chip.textContent = (index + 1) + ": " + (header === "" ? "[empty]" : header); headerList.appendChild(chip);
      });
      if (result.headers.length > 40) {
        const chip = document.createElement("span"); chip.className = "header-chip";
        chip.textContent = (result.headers.length - 40) + " additional headers in the download"; headerList.appendChild(chip);
      }
      result.issues.slice(0, 40).forEach(issue => addIssue(issue.message));
      if (result.noticeCount > 40) addIssue((result.noticeCount - 40) + " additional notices omitted from this panel. All string values remain in the JSON export.");
      if (!result.issues.length) addIssue("No quoting, header, row-width, or formula-like-cell issues found. This does not validate the meaning of your data.", "success");
      const output = { headers: result.headers, rows: result.rows };
      downloadable = JSON.stringify(output, null, 2) + "\n";
      const shortOutput = { headers: result.headers.slice(0, 40), rows: result.rows.slice(0, 8).map(row => row.slice(0, 40)) };
      const rendered = JSON.stringify(shortOutput, null, 2);
      preview.textContent = rendered.length > 16000 ? rendered.slice(0, 16000) + "\n… preview truncated" : rendered;
      byId("preview-note").textContent = "Preview: first " + Math.min(result.rows.length, 8) + " data records; first 40 fields per record" + (rendered.length > 16000 ? ", truncated to 16,000 characters" : "") + ". Download includes every parsed record. Header and row arrays preserve all string values, repeated headers, and uneven lengths. No repair is inferred or applied.";
      downloadButton.disabled = !result.headers.length;
      return result;
    } catch (error) { showError(error.message); return { error: error.message }; }
  }
  function setInput(value, fileName = "") {
    cancelPendingRead();
    sourceFileName = fileName;
    byId("file-name").textContent = sourceFileName;
    rawInput = value; input.value = value; return inspect();
  }
  byId("inspect-button").addEventListener("click", () => { cancelPendingRead(); inspect(); });
  byId("sample-button").addEventListener("click", () => { byId("csv-file").value = ""; byId("file-name").textContent = ""; setInput(SAMPLE); });
  function invalidate() {
    downloadable = null; downloadButton.disabled = true; resultState.textContent = "INPUT CHANGED";
    summary.textContent = "Input changed. Inspect again to refresh the results.";
  }
  input.addEventListener("input", () => {
    cancelPendingRead();
    rawInput = reconcileText(rawInput, input.value);
    invalidate();
  });
  input.addEventListener("paste", event => {
    if (!event.clipboardData || !Array.from(event.clipboardData.types).includes("text/plain")) return;
    event.preventDefault();
    cancelPendingRead();
    const pasted = event.clipboardData.getData("text/plain"), displayStart = input.selectionStart;
    const start = rawOffset(rawInput, displayStart), end = rawOffset(rawInput, input.selectionEnd);
    rawInput = rawInput.slice(0, start) + pasted + rawInput.slice(end);
    input.value = rawInput;
    const caret = displayStart + pasted.replace(/\r\n?/g, "\n").length;
    input.setSelectionRange(caret, caret);
    invalidate();
  });
  byId("csv-file").addEventListener("change", async event => {
    const file = event.target.files[0];
    cancelPendingRead();
    if (!file) return;
    const generation = inputGeneration;
    pendingFileRead = true;
    byId("file-name").textContent = file.name;
    downloadable = null; downloadButton.disabled = true;
    if (file.size > MAX_BYTES) {
      cancelPendingRead();
      showError("File exceeds the 2 MB limit. Choose a smaller synthetic example."); return;
    }
    try {
      const buffer = await file.arrayBuffer();
      if (generation !== inputGeneration) return;
      const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buffer);
      setInput(text, file.name);
    } catch (error) {
      if (generation !== inputGeneration) return;
      cancelPendingRead();
      showError("Could not read this file as UTF-8 text. Save a UTF-8 CSV and try again.");
    }
  });
  downloadButton.addEventListener("click", () => {
    if (!downloadable) return;
    const blob = new Blob([downloadable], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob), link = document.createElement("a");
    link.href = url; link.download = "repvblicvs-csv-strings.json"; document.body.appendChild(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  const emailURL = "mailto:repvblicvs@gmail.com?subject=" + encodeURIComponent("Repvblicvs scope review") + "&body=" + encodeURIComponent(INTAKE);
  document.querySelectorAll(".intake-link").forEach(link => { link.href = emailURL; });
  setInput(SAMPLE);
  // Optional, page-scoped agent interface. It shares the visible inspection flow.
  try {
    const context = document.modelContext;
    if (context && typeof context.registerTool === "function") {
      const lifecycle = new AbortController();
      const handleRegistrationError = () => lifecycle.abort();
      window.addEventListener("pagehide", () => lifecycle.abort(), { once: true });
      try {
        Promise.resolve(context.registerTool({
          name: "inspect_csv",
          title: "Inspect local CSV",
          description: "Replace the visible CSV input and run the local inspector. Returns diagnostic counts. Does not download files or send data.",
          inputSchema: {
            type: "object",
            properties: { csv: { type: "string", description: "Comma-separated text, at most 2 MiB when encoded as UTF-8." } },
            required: ["csv"], additionalProperties: false
          },
          annotations: { readOnlyHint: false, untrustedContentHint: true },
          execute(payload) {
            if (!payload || typeof payload !== "object" || Array.isArray(payload) || Object.keys(payload).length !== 1 || Object.keys(payload)[0] !== "csv" || typeof payload.csv !== "string") {
              throw new TypeError("Expected one csv string property.");
            }
            if (new TextEncoder().encode(payload.csv).length > MAX_BYTES) {
              throw new RangeError("CSV input exceeds the 2 MiB UTF-8 limit.");
            }
            byId("csv-file").value = ""; byId("file-name").textContent = "";
            const result = setInput(payload.csv);
            if (result.error) throw new Error(result.error);
            return { headerCount: result.headers.length, rowCount: result.rows.length, issueCount: result.noticeCount, unevenRowCount: result.mismatchCount, formulaLikeCellCount: result.formulaCount };
          }
        }, { signal: lifecycle.signal })).catch(handleRegistrationError);
      } catch (error) { handleRegistrationError(); }
    }
  } catch (error) { /* Unsupported registries must never interrupt the visible UI. */ }
})();
