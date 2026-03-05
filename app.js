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

    await loadRanking(select.value);

    select.addEventListener("change", async (e) => {
      await loadRanking(e.target.value);
      // 날짜 바뀌면 검색 유지한 채로 1페이지부터 다시
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
  // pager는 renderPager에서 이벤트를 위임 방식으로 처리
  const pager = document.getElementById("pager");
  if (!pager) return;

  pager.addEventListener("click", (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;

    const action = t.getAttribute("data-action");
    if (!action) return;

    const totalPages = Math.max(1, Math.ceil(FILTERED_ROWS.length / PAGE_SIZE));

    if (action === "prev" && CURRENT_PAGE > 1) CURRENT_PAGE--;
    if (action === "next" && CURRENT_PAGE < totalPages) CURRENT_PAGE++;
    if (action === "first") CURRENT_PAGE = 1;
    if (action === "last") CURRENT_PAGE = totalPages;

    renderCurrentPage(); // ✅ 페이지 이동은 렌더만 다시
  });
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

    // ✅ 날짜 바뀔 때는 1페이지부터
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
  const pager = document.getElementById("pager");
  if (!pager) return;

  const prevDisabled = CURRENT_PAGE <= 1 ? "disabled" : "";
  const nextDisabled = CURRENT_PAGE >= totalPages ? "disabled" : "";

  pager.innerHTML = `
    <div class="info">표시: <b>${from + 1}</b>~<b>${to}</b> / 전체 <b>${total}</b> (페이지당 ${PAGE_SIZE})</div>
    <button data-action="first" ${prevDisabled}>처음</button>
    <button data-action="prev" ${prevDisabled}>이전</button>
    <div class="page"><b>${CURRENT_PAGE}</b> / ${totalPages}</div>
    <button data-action="next" ${nextDisabled}>다음</button>
    <button data-action="last" ${nextDisabled}>마지막</button>
  `;
}

loadSnapshots();
