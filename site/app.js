let SNAP_LIST = [];
let CURRENT_VIEW_ROWS = [];     // 계산된 전체 rows
let FILTERED_ROWS = [];         // 검색 적용된 rows

let PAGE_SIZE = 100;
let CURRENT_PAGE = 1;
function getDateKeyFromFile(fileName){
  // ranking_2026_03_05.json -> 2026_03_05
  const m = String(fileName || "").match(/(\d{4}_\d{2}_\d{2})/);
  return m ? m[1] : null;
}

function toNum(v) {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}
function keyOf(guild, server) {
  return `${(guild ?? "").trim()}@@${(server ?? "").trim()}`;
}
function escapeHtml(s){
  return String(s ?? "")
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;")
    .replace(/'/g,"&#39;");
}

async function loadSnapshots() {
  const statusEl = document.getElementById("status");
  const select = document.getElementById("date");

  try {
    const res = await fetch("./snapshots/index.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`index.json HTTP ${res.status}`);
    SNAP_LIST = await res.json();

    select.innerHTML = "";
    if (!Array.isArray(SNAP_LIST) || SNAP_LIST.length === 0) {
      if (statusEl) statusEl.textContent = "status: 스냅샷이 없습니다";
      return;
    }

    for (const item of SNAP_LIST) {
      const opt = document.createElement("option");
      opt.value = item.file;
      opt.textContent = item.label;
      select.appendChild(opt);
    }

    bindSearchUI();
    bindPagerUI();
    bindGuildDetailUI();

    // ✅ 최초 로드
    await loadRanking(select.value);

    // ✅ 날짜 변경 시만 데이터 로드/계산
    select.addEventListener("change", async (e) => {
      await loadRanking(e.target.value);
      CURRENT_PAGE = 1;
      applySearch();
    });

    if (statusEl) statusEl.textContent = `status: OK (${SNAP_LIST.length} files)`;
  } catch (err) {
    if (statusEl) statusEl.textContent = `status: ERROR: ./snapshots/index.json -> ${err.message}`;
    console.error(err);
  }
}

function bindSearchUI(){
  const input = document.getElementById("search");
  const btnSearch = document.getElementById("btnSearch");
  const btnClear  = document.getElementById("btnClear");
  const form = document.getElementById("searchForm");

  if (btnSearch) btnSearch.addEventListener("click", () => {
    CURRENT_PAGE = 1;
    applySearch();
  });

  if (btnClear) btnClear.addEventListener("click", () => {
    if (input) input.value = "";
    CURRENT_PAGE = 1;
    applySearch();
  });

  // ✅ 엔터 검색
  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      CURRENT_PAGE = 1;
      applySearch();
    });
  } else if (input) {
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        CURRENT_PAGE = 1;
        applySearch();
      }
    });
  }

  // ✅ input 실시간 렌더 금지
}

function bindPagerUI(){
  const pageSize = document.getElementById("pageSize");
  const btnFirst = document.getElementById("btnFirst");
  const btnPrev  = document.getElementById("btnPrev");
  const btnNext  = document.getElementById("btnNext");
  const btnLast  = document.getElementById("btnLast");
  const pagerNums = document.getElementById("pagerNums");

  // ✅ 페이지당 변경
  if (pageSize) {
    PAGE_SIZE = toNum(pageSize.value) || 100;
    pageSize.addEventListener("change", () => {
      PAGE_SIZE = toNum(pageSize.value) || 100;
      CURRENT_PAGE = 1;
      renderCurrentPage();
    });
  }

  // ✅ 이동 버튼
  if (btnFirst) btnFirst.addEventListener("click", () => {
    CURRENT_PAGE = 1;
    renderCurrentPage();
  });

  if (btnPrev) btnPrev.addEventListener("click", () => {
    if (CURRENT_PAGE > 1) CURRENT_PAGE--;
    renderCurrentPage();
  });

  if (btnNext) btnNext.addEventListener("click", () => {
    const totalPages = Math.max(1, Math.ceil(FILTERED_ROWS.length / PAGE_SIZE));
    if (CURRENT_PAGE < totalPages) CURRENT_PAGE++;
    renderCurrentPage();
  });

  if (btnLast) btnLast.addEventListener("click", () => {
    const totalPages = Math.max(1, Math.ceil(FILTERED_ROWS.length / PAGE_SIZE));
    CURRENT_PAGE = totalPages;
    renderCurrentPage();
  });

  // ✅ 숫자 버튼 클릭(이벤트 위임)
  if (pagerNums) {
    pagerNums.addEventListener("click", (e) => {
      const t = e.target;
      if (!(t instanceof HTMLElement)) return;
      const p = t.getAttribute("data-page");
      if (!p) return;
      const page = toNum(p);
      if (!page) return;
      CURRENT_PAGE = page;
      renderCurrentPage();
    });
  }
}

async function fetchRows(fileName) {
  const res = await fetch(`./snapshots/${fileName}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`${fileName} HTTP ${res.status}`);
  const rows = await res.json();
  return Array.isArray(rows) ? rows : [];
}

async function loadRanking(fileName) {
  const statusEl = document.getElementById("status");

  try {
    const curRows = await fetchRows(fileName);

    const idx = SNAP_LIST.findIndex((x) => x.file === fileName);
    const prevFile = (idx >= 0 && idx + 1 < SNAP_LIST.length) ? SNAP_LIST[idx + 1].file : null;

    const prevMap = new Map();
    if (prevFile) {
      const prevRows = await fetchRows(prevFile);
      for (const r of prevRows) {
        const k = keyOf(r.guild ?? "", r.server ?? "");
        prevMap.set(k, {
          score: toNum(r.total_score ?? r.score_total ?? r.total ?? 0),
          rank:  toNum(r.rank ?? 0),
        });
      }
    }

    CURRENT_VIEW_ROWS = curRows.map((r) => {
      const curRank = toNum(r.rank ?? 0);
      const guild = r.guild ?? "";
      const server = r.server ?? "";
      const total = toNum(r.total_score ?? r.score_total ?? r.total ?? 0);

      const prev = prevMap.get(keyOf(guild, server));
      const prevScore = prev ? prev.score : 0;
      const prevRank  = prev ? prev.rank  : 0;

      const scoreDelta = prevFile ? (total - prevScore) : 0;
      const rankDelta  = (prevFile && prevRank && curRank) ? (prevRank - curRank) : 0;

      let moveText = "-";
      let moveClass = "delta-flat";
      if (prevFile && rankDelta !== 0) {
        if (rankDelta > 0) { moveText = `▲ ${rankDelta}`; moveClass = "delta-up"; }
        else { moveText = `▼ ${Math.abs(rankDelta)}`; moveClass = "delta-down"; }
      }

      let scoreText = prevFile ? "-" : "";
      let scoreClass = "delta-flat";
      if (prevFile && scoreDelta !== 0) {
        if (scoreDelta > 0) { scoreText = `▲ ${scoreDelta.toLocaleString()}`; scoreClass = "delta-up"; }
        else { scoreText = `▼ ${Math.abs(scoreDelta).toLocaleString()}`; scoreClass = "delta-down"; }
      }

      return { curRank, guild, server, total, moveText, moveClass, scoreText, scoreClass };
    });

    CURRENT_PAGE = 1;
    applySearch();

    if (statusEl) {
      statusEl.textContent = prevFile
        ? `status: OK (${fileName}) - ${curRows.length} rows / compare: ${prevFile}`
        : `status: OK (${fileName}) - ${curRows.length} rows / compare: (없음)`;
    }
  } catch (err) {
    if (statusEl) statusEl.textContent = `status: ERROR: ${fileName} -> ${err.message}`;
    console.error(err);
  }
}

function applySearch(){
  const input = document.getElementById("search");
  const q = (input?.value ?? "").trim().toLowerCase();

  FILTERED_ROWS = !q ? CURRENT_VIEW_ROWS : CURRENT_VIEW_ROWS.filter((x) => {
    return (
      String(x.guild).toLowerCase().includes(q) ||
      String(x.server).toLowerCase().includes(q)
    );
  });

  renderCurrentPage();
}

function renderCurrentPage(){
  const total = FILTERED_ROWS.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (CURRENT_PAGE > totalPages) CURRENT_PAGE = totalPages;

  const start = (CURRENT_PAGE - 1) * PAGE_SIZE;
  const end = start + PAGE_SIZE;
  const pageRows = FILTERED_ROWS.slice(start, end);

  renderRows(pageRows);
  renderPager(total, totalPages, start, Math.min(end, total));
}

function renderRows(rows){
  const tbody = document.getElementById("rank");
  if (!tbody) return;

  let html = "";
  for (const x of rows) {
    html += `
      <tr data-guild="${escapeHtml(x.guild)}" data-server="${escapeHtml(x.server)}" style="cursor:pointer;">
        <td class="delta-cell ${x.moveClass}">${escapeHtml(x.moveText)}</td>
        <td>${x.curRank || ""}</td>
        <td>${escapeHtml(x.guild)}</td>
        <td>${escapeHtml(x.server)}</td>
        <td>${x.total ? x.total.toLocaleString() : ""}</td>
        <td class="delta-cell ${x.scoreClass}">${escapeHtml(x.scoreText)}</td>
      </tr>
    `;
  }
  tbody.innerHTML = html;
}

function renderPager(total, totalPages, from, to){
  const infoEl = document.getElementById("pagerInfo");
  const pageEl = document.getElementById("pagerPage");
  const numsEl = document.getElementById("pagerNums");

  const btnFirst = document.getElementById("btnFirst");
  const btnPrev  = document.getElementById("btnPrev");
  const btnNext  = document.getElementById("btnNext");
  const btnLast  = document.getElementById("btnLast");

  if (infoEl) infoEl.innerHTML = `표시: <b>${total ? (from + 1) : 0}</b>~<b>${to}</b> / 전체 <b>${total}</b>`;
  if (pageEl) pageEl.innerHTML = `<b>${CURRENT_PAGE}</b> / ${totalPages}`;

  const prevDisabled = CURRENT_PAGE <= 1 || totalPages <= 1;
  const nextDisabled = CURRENT_PAGE >= totalPages || totalPages <= 1;

  if (btnFirst) btnFirst.disabled = prevDisabled;
  if (btnPrev)  btnPrev.disabled  = prevDisabled;
  if (btnNext)  btnNext.disabled  = nextDisabled;
  if (btnLast)  btnLast.disabled  = nextDisabled;

  // ✅ 숫자 페이지 버튼 (최대 10개)
  if (numsEl) {
    const MAX_BTNS = 10;

    let startPage = Math.max(1, CURRENT_PAGE - Math.floor(MAX_BTNS / 2));
    let endPage = startPage + MAX_BTNS - 1;

    if (endPage > totalPages) {
      endPage = totalPages;
      startPage = Math.max(1, endPage - MAX_BTNS + 1);
    }

    let html = "";
    for (let p = startPage; p <= endPage; p++) {
      const active = (p === CURRENT_PAGE) ? "active" : "";
      html += `<button type="button" class="${active}" data-page="${p}">${p}</button>`;
    }
    numsEl.innerHTML = html;
  }
}
function bindGuildDetailUI(){
  const tbody = document.getElementById("rank");
  const modal = document.getElementById("guildModal");
  const closeBtn = document.getElementById("gmClose");

  if (closeBtn) closeBtn.addEventListener("click", hideModal);
  if (modal) modal.addEventListener("click", (e) => {
    if (e.target === modal) hideModal();
  });

  if (!tbody) return;

  // tbody 안의 tr 클릭 시 detail 로드
  // tbody 안의 tr 클릭 시 detail 로드
tbody.addEventListener("click", async (e) => {
  const tr = e.target.closest("tr");
  if (!tr) return;

  const guild = tr.getAttribute("data-guild") || "";
  const server = tr.getAttribute("data-server") || "";
  if (!guild || !server) return;

  const fileName = document.getElementById("date")?.value;
  const dateKey = getDateKeyFromFile(fileName);
  if (!dateKey) {
    alert("날짜키를 못 찾았어요. 파일명에 2026_03_05 형태가 있어야 합니다.");
    return;
  }

  try {
   // ✅ 서버명 정규화
const serverRaw = String(server ?? "");
const serverNorm = serverRaw
  .replace(/\u00A0/g, " ")   // NBSP → 일반 공백
  .replace(/\s+/g, " ")
  .trim();

// ✅ 후보들: "별세이즈 03" / "별세이즈03" / "별세이즈03"(전체공백제거)
const candidates = [
  serverNorm,
  serverNorm.replace(/\s+(\d+)$/, "$1"),     // 끝 숫자 앞 공백 제거: " 03" -> "03"
  serverNorm.replace(/\s+/g, ""),            // 모든 공백 제거
];

// ✅ 후보 URL 순서대로 시도
let data = null;
let lastErr = null;

for (const s of candidates) {
  const serverFile = encodeURIComponent(s) + ".json";
  const url = `./snapshots/detail_${dateKey}/${serverFile}`;

  console.log("try server =", JSON.stringify(s), "->", serverFile);
  console.log("fetch url =", url);

  const res = await fetch(url, { cache: "no-store" });
  if (res.ok) {
    data = await res.json();
    break;
  } else {
    lastErr = `HTTP ${res.status} / ${url}`;
  }
}

if (!data) throw new Error(`detail fetch 실패: ${lastErr}`);

// guild 키도 trim
const guildKey = String(guild ?? "").trim();
const g = data?.guilds?.[guildKey];

if (!g) {
  showModal(guildKey, `${serverNorm} / ${dateKey}`, `<div style="opacity:.85;">집계 데이터 없음</div>`, "");
  return;
}

const clsHtml = renderKeyValueTable(g.byClass, "직업", "인원");
const grdHtml = renderKeyValueTable(g.byGrade, "등급", "인원");
showModal(guildKey, `${serverNorm} / ${dateKey} / 총원 ${g.members}명`, clsHtml, grdHtml);

function renderKeyValueTable(obj, col1, col2){
  const entries = Object.entries(obj || {});
  if (entries.length === 0) return `<div style="opacity:.85;">데이터 없음</div>`;

  // 인원 내림차순 정렬
  entries.sort((a,b) => (b[1]||0) - (a[1]||0));

  let html = `<table style="width:100%; border-collapse:collapse; font-size:12px;">
    <thead>
      <tr>
        <th style="text-align:left; border-bottom:1px solid #23324a; padding:6px;">${escapeHtml(col1)}</th>
        <th style="text-align:right; border-bottom:1px solid #23324a; padding:6px;">${escapeHtml(col2)}</th>
      </tr>
    </thead><tbody>`;

  for (const [k,v] of entries){
  html += `<tr>
    <td style="padding:6px; border-bottom:1px solid rgba(35,50,74,.6); text-align:center;">${escapeHtml(k)}</td>
    <td style="padding:6px; border-bottom:1px solid rgba(35,50,74,.6); text-align:center;">${Number(v||0).toLocaleString()}</td>
  </tr>`;
}
  html += `</tbody></table>`;
  return html;
}

function showModal(title, sub, clsHtml, grdHtml){
  const modal = document.getElementById("guildModal");
  const t = document.getElementById("gmTitle");
  const s = document.getElementById("gmSub");
  const c = document.getElementById("gmClass");
  const g = document.getElementById("gmGrade");

  if (t) t.textContent = title;
  if (s) s.textContent = sub;
  if (c) c.innerHTML = clsHtml;
  if (g) g.innerHTML = grdHtml;

  if (modal) modal.style.display = "block";
}

function hideModal(){
  const modal = document.getElementById("guildModal");
  if (modal) modal.style.display = "none";
}
loadSnapshots();
