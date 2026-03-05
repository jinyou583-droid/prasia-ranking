let SNAP_LIST = []; // index.json 목록 저장 (최신 -> 과거)

function toNum(v) {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function keyOf(guild, server) {
  return `${(guild ?? "").trim()}@@${(server ?? "").trim()}`;
}

async function loadSnapshots() {
  const statusEl = document.getElementById("status");
  const select = document.getElementById("date");

  try {
    const res = await fetch("./snapshots/index.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`index.json HTTP ${res.status}`);

    // index.json = [{label,file,rows}, ...]
    SNAP_LIST = await res.json();

    select.innerHTML = "";

    if (!Array.isArray(SNAP_LIST) || SNAP_LIST.length === 0) {
      if (statusEl) statusEl.textContent = "status: 스냅샷이 없습니다 (uploads에 xlsx 올리고 빌드 확인)";
      return;
    }

    for (const item of SNAP_LIST) {
      const opt = document.createElement("option");
      opt.value = item.file;        // 예: ranking_2026_03_05.json
      opt.textContent = item.label; // 예: 2026-03-05
      select.appendChild(opt);
    }

    await loadRanking(select.value);

    select.addEventListener("change", async (e) => {
      await loadRanking(e.target.value);
    });

    if (statusEl) statusEl.textContent = `status: OK (${SNAP_LIST.length} files)`;
  } catch (err) {
    if (statusEl) statusEl.textContent = `status: ERROR: ./snapshots/index.json -> ${err.message}`;
    console.error(err);
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
  const tbody = document.getElementById("rank");

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

    tbody.innerHTML = "";

    for (const r of curRows) {
      const curRank = toNum(r.rank ?? 0);
      const guild = r.guild ?? "";
      const server = r.server ?? "";
      const total = toNum(r.total_score ?? r.score_total ?? r.total ?? 0);

      const k = keyOf(guild, server);
      const prev = prevMap.get(k);

      const prevScore = prev ? prev.score : 0;
      const prevRank  = prev ? prev.rank  : 0;

      // ✅ 점수 차이
      const scoreDelta = prevFile ? (total - prevScore) : 0;

      // ✅ 순위 변동: (이전순위 - 현재순위) => +면 상승, -면 하락
      const rankDelta = (prevFile && prevRank && curRank) ? (prevRank - curRank) : 0;

      // 변동(등수) 표시
      let moveText = "-";
      let moveClass = "delta-flat";
      if (prevFile && rankDelta !== 0) {
        if (rankDelta > 0) { moveText = `▲ ${rankDelta}`; moveClass = "delta-up"; }
        else { moveText = `▼ ${Math.abs(rankDelta)}`; moveClass = "delta-down"; }
      }

      // 기존대비(점수) 표시
      let scoreText = prevFile ? "-" : "";
      let scoreClass = "delta-flat";
      if (prevFile && scoreDelta !== 0) {
        if (scoreDelta > 0) { scoreText = `▲ ${scoreDelta.toLocaleString()}`; scoreClass = "delta-up"; }
        else { scoreText = `▼ ${Math.abs(scoreDelta).toLocaleString()}`; scoreClass = "delta-down"; }
      }

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="delta-cell ${moveClass}">${moveText}</td>
        <td>${curRank || ""}</td>
        <td>${guild}</td>
        <td>${server}</td>
        <td>${total ? total.toLocaleString() : ""}</td>
        <td class="delta-cell ${scoreClass}">${scoreText}</td>
      `;
      tbody.appendChild(tr);
    }

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

loadSnapshots();
