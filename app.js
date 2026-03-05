let SNAP_LIST = [];          // index.json 목록 저장 (최신 -> 과거)
let CURRENT_VIEW_ROWS = [];  // ✅ 현재 날짜의 "표에 보여줄 최종 rows"를 메모리에 저장(검색은 이걸로만)

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
      if (statusEl) statusEl.textContent = "status: 스냅샷이 없습니다 (uploads에 xlsx 올리고 빌드 확인)";
      return;
    }

    for (const item of SNAP_LIST) {
      const opt = document.createElement("option");
      opt.value = item.file;
      opt.textContent = item.label;
      select.appendChild(opt);
    }

    // ✅ 최초 로드
    await loadRanking(select.value);

    // ✅ 날짜 변경 시만 데이터 로드/계산
    select.addEventListener("change", async (e) => {
      await loadRanking(e.target.value);

      // 날짜 바꿨으면 검색어는 유지해도 되고(유지), 초기화해도 됨(아래는 유지)
      applySearch(); // 현재 검색어 기준으로 다시 필터/렌더
    });

    // ✅ 검색 버튼/엔터/초기화 연결
    bindSearchUI();

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

  // index.html에 버튼이 없을 수도 있으니 안전하게
  if (btnSearch) btnSearch.addEventListener("click", applySearch);
  if (btnClear) btnClear.addEventListener("click", () => {
    if (input) input.value = "";
    applySearch();
  });

  // ✅ 엔터키로 검색
  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      applySearch();
    });
  } else if (input) {
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") applySearch();
    });
  }

  // ✅ 핵심: input 이벤트로는 아무것도 안 함(실시간 렌더 금지)
  // 필요하면 “검색어 입력 중 표시” 정도만 하고 싶다면 여기서 상태만 바꿔도 됨.
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

    // 현재 파일의 index 위치 -> 바로 다음이 "이전 데이터"
    const idx = SNAP_LIST.findIndex((x) => x.file === fileName);
    const prevFile = (idx >= 0 && idx + 1 < SNAP_LIST.length) ? SNAP_LIST[idx + 1].file : null;

    // prevMap: key -> {score, rank}
    const prevMap = new Map();
    if (prevFile) {
      const prevRows = await fetchRows(prevFile);
      for (const r of prevRows) {
        const g = r.guild ?? "";
        const s = r.server ?? "";
        const k = keyOf(g, s);
        const score = toNum(r.total_score ?? r.score_total ?? r.total ?? 0);
        const rank = toNum(r.rank ?? 0);
        prevMap.set(k, { score, rank });
      }
    }

    // ✅ 계산된 "표용 데이터"를 메모리에 저장 (여기까지가 무거운 작업)
    CURRENT_VIEW_ROWS = curRows.map((r) => {
      const curRank = toNum(r.rank ?? 0);
      const guild = r.guild ?? "";
      const server = r.server ?? "";
      const total = toNum(r.total_score ?? r.score_total ?? r.total ?? 0);

      const k = keyOf(guild, server);
      const prev = prevMap.get(k);

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

      return {
        curRank,
        guild,
        server,
        total,
        moveText,
        moveClass,
        scoreText,
        scoreClass,
      };
    });

    // ✅ 최초 렌더 (검색어 반영해서 렌더)
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

  let filtered = CURRENT_VIEW_ROWS;

  if (q) {
    filtered = CURRENT_VIEW_ROWS.filter((x) => {
      return (
        String(x.guild).toLowerCase().includes(q) ||
        String(x.server).toLowerCase().includes(q)
      );
    });
  }

  renderRows(filtered);
}

function renderRows(rows){
  const tbody = document.getElementById("rank");
  if (!tbody) return;

  // ✅ DOM 조작 최소화: innerHTML 한 번에
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

loadSnapshots();
