let SNAP_LIST = []; // index.json 목록 저장 (최신 -> 과거)
SNAP_LIST = list;

function toNum(v) {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function keyOf(row) {
  // 결사+서버 조합으로 비교 (동명이인 결사 방지)
  return `${row.guild ?? ""}@@${row.server ?? ""}`;
}

function fmtDelta(d) {
  if (d > 0) return `▲ ${d.toLocaleString()}`;
  if (d < 0) return `▼ ${Math.abs(d).toLocaleString()}`;
  return `-`;
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
      statusEl && (statusEl.textContent = "status: 스냅샷이 없습니다 (uploads에 xlsx 올리고 빌드 확인)");
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

    statusEl && (statusEl.textContent = `status: OK (${SNAP_LIST.length} files)`);
  } catch (err) {
    statusEl && (statusEl.textContent = `status: ERROR: ./snapshots/index.json -> ${err.message}`);
    console.error(err);
  }
}

async function fetchRows(fileName) {
  // fileName 예: ranking_2026_03_05.json
  const res = await fetch(`./snapshots/${fileName}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`${fileName} HTTP ${res.status}`);
  const rows = await res.json(); // 배열
  if (!Array.isArray(rows)) return [];
  return rows;
}

async function loadRanking(fileName) {
  const statusEl = document.getElementById("status");
  const tbody = document.getElementById("rank");

  try {
    const curRes = await fetch(`./snapshots/${fileName}`, { cache: "no-store" });
    if (!curRes.ok) throw new Error(`${fileName} HTTP ${curRes.status}`);
    const curRows = await curRes.json(); // 배열

    // ✅ index.json 목록(SNAP_LIST)을 이미 loadSnapshots에서 들고 있다고 가정
    // 만약 SNAP_LIST가 없다면 아래 3줄은 에러남 → (3단계에서 SNAP_LIST 추가 안내함)
    const idx = SNAP_LIST.findIndex((x) => x.file === fileName);
    const prevFile = (idx >= 0 && idx + 1 < SNAP_LIST.length) ? SNAP_LIST[idx + 1].file : null;

    // prevMap: key -> { score, rank }
    let prevMap = new Map();
    if (prevFile) {
      const prevRes = await fetch(`./snapshots/${prevFile}`, { cache: "no-store" });
      if (prevRes.ok) {
        const prevRows = await prevRes.json();
        for (const r of prevRows) {
          const k = `${(r.guild ?? "").trim()}@@${(r.server ?? "").trim()}`;
          const score = Number(r.total_score ?? r.score_total ?? r.total ?? 0) || 0;
          const rank = Number(r.rank ?? 0) || 0;
          prevMap.set(k, { score, rank });
        }
      }
    }

    tbody.innerHTML = "";

    for (const r of curRows) {
      const curRank = Number(r.rank ?? 0) || 0;
      const guild = r.guild ?? "";
      const server = r.server ?? "";
      const total = Number(r.total_score ?? r.score_total ?? r.total ?? 0) || 0;

      const k = `${guild.trim()}@@${server.trim()}`;
      const prev = prevMap.get(k);

      const prevScore = prev ? prev.score : 0;
      const prevRank = prev ? prev.rank : 0;

      // ✅ 점수 차이
      const scoreDelta = prevFile ? (total - prevScore) : 0;

      // ✅ 순위 변동(이전 - 현재) : +면 상승, -면 하락
      const rankDelta = (prevFile && prevRank && curRank) ? (prevRank - curRank) : 0;

      // 변동(등수) 텍스트/색
      let moveText = "-";
      let moveClass = "delta-flat";
      if (prevFile && rankDelta !== 0) {
        if (rankDelta > 0) { moveText = `▲ ${rankDelta}`; moveClass = "delta-up"; }
        else { moveText = `▼ ${Math.abs(rankDelta)}`; moveClass = "delta-down"; }
      }

      // 기존대비(점수) 텍스트/색
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

    statusEl && (statusEl.textContent =
      prevFile
        ? `status: OK (${fileName}) - ${curRows.length} rows / compare: ${prevFile}`
        : `status: OK (${fileName}) - ${curRows.length} rows / compare: (없음)`
    );
  } catch (err) {
    statusEl && (statusEl.textContent = `status: ERROR: ${fileName} -> ${err.message}`);
    console.error(err);
  }
}

    tbody.innerHTML = "";

    for (const r of curRows) {
      const tr = document.createElement("tr");

      const rank = r.rank ?? "";
      const guild = r.guild ?? "";
      const server = r.server ?? "";
      const total = toNum(r.total_score ?? r.score_total ?? r.total ?? 0);

      const prev = prevMap.get(keyOf(r)) ?? 0;
      const delta = prevFile ? (total - prev) : 0;

      // 변동(▲/▼/ -) + 기존대비(숫자)
      const arrow = delta > 0 ? "▲" : (delta < 0 ? "▼" : "-");

      tr.innerHTML = `
        <td>${arrow}</td>
        <td>${rank}</td>
        <td>${guild}</td>
        <td>${server}</td>
        <td>${total ? total.toLocaleString() : ""}</td>
        <td>${prevFile ? fmtDelta(delta) : "-"}</td>
      `;
      tbody.appendChild(tr);
    }

    statusEl && (statusEl.textContent =
      prevFile
        ? `status: OK (${fileName}) - ${curRows.length} rows / compare: ${prevFile}`
        : `status: OK (${fileName}) - ${curRows.length} rows / compare: (없음)`
    );
  } catch (err) {
    statusEl && (statusEl.textContent = `status: ERROR: ${fileName} -> ${err.message}`);
    console.error(err);
  }
}

loadSnapshots();
