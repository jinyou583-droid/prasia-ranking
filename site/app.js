async function loadSnapshots() {
  const statusEl = document.getElementById("status");
  const select = document.getElementById("date");

  try {
    // ✅ site/ 가 배포 루트이므로 ./snapshots 로 접근
    const res = await fetch("./snapshots/index.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`index.json HTTP ${res.status}`);

    const list = await res.json(); // [{label,file,rows}, ...]

    // 옵션 초기화
    select.innerHTML = "";

    if (!Array.isArray(list) || list.length === 0) {
      statusEl && (statusEl.textContent = "status: 스냅샷이 없습니다 (uploads에 xlsx 업로드 후 빌드 확인)");
      return;
    }

    // 드롭다운 채우기
    for (const item of list) {
      const opt = document.createElement("option");
      opt.value = item.file;          // ✅ 파일명 자체를 value로 저장
      opt.textContent = item.label;   // 화면에 보일 날짜/라벨
      select.appendChild(opt);
    }

    // 첫번째 자동 로드
    await loadRanking(select.value);

    // 변경 시 로드
    select.addEventListener("change", async (e) => {
      await loadRanking(e.target.value);
    });

    statusEl && (statusEl.textContent = `status: OK (${list.length} files)`);
  } catch (err) {
    statusEl && (statusEl.textContent = `status: ERROR: ./snapshots/index.json -> ${err.message}`);
    console.error(err);
  }
}

async function loadRanking(fileName) {
  const statusEl = document.getElementById("status");
  const tbody = document.getElementById("rank");

  try {
    const res = await fetch(`./snapshots/${fileName}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`${fileName} HTTP ${res.status}`);

    const rows = await res.json(); // [{rank,guild,server,hunt_score,level_score,total_score}, ...]

    tbody.innerHTML = "";

    if (!Array.isArray(rows) || rows.length === 0) {
      statusEl && (statusEl.textContent = `status: OK (${fileName}) - 0 rows`);
      return;
    }

    // 표시: rank / server / guild / total_score (원하면 컬럼 바꿔줄게)
    for (const r of rows) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${r.rank ?? ""}</td>
        <td>${r.server ?? ""}</td>
        <td>${r.guild ?? ""}</td>
        <td>${r.total_score ?? ""}</td>
      `;
      tbody.appendChild(tr);
    }

    statusEl && (statusEl.textContent = `status: OK (${fileName}) - ${rows.length} rows`);
  } catch (err) {
    statusEl && (statusEl.textContent = `status: ERROR: ./snapshots/${fileName} -> ${err.message}`);
    console.error(err);
  }
}

loadSnapshots();
