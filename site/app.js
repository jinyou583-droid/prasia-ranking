let SNAP_LIST = [];
let CURRENT_VIEW_ROWS = [];     // 계산된 전체 rows
let FILTERED_ROWS = [];         // 검색 적용된 rows

let PAGE_SIZE = 100;
let CURRENT_PAGE = 1;

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
      <tr>
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

loadSnapshots();
